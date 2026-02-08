import { sql } from "drizzle-orm";
import { getDb } from "@/utils/bindings";
import type { CandidateGroup, GroupItem } from "./types";

interface GroupRow {
	retailer_item_id: string;
	raw_name: string;
	normalized_name: string | null;
	brand: string | null;
	category: string | null;
	unit: string | null;
	unit_quantity: string | null;
	total_amount: number | null;
	pack_amount: number | null;
	container_type: string | null;
	chain_slug: string | null;
	embedding: unknown;
}

export interface BuildGroupQuery {
	namePattern?: string;
	nameRegex?: string;
	category?: string;
	brand?: string;
	chainSlug?: string;
	limit?: number;
	randomSample?: boolean;
}

function getRows<T>(result: unknown): T[] {
	if (Array.isArray(result)) {
		return result as T[];
	}
	return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

function maybeWrapLikePattern(value: string): string {
	if (value.includes("%") || value.includes("_")) {
		return value;
	}
	return `%${value}%`;
}

function normalizeNullableString(
	value: string | null | undefined,
): string | null {
	if (value == null) {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function normalizeNullableNumber(
	value: number | null | undefined,
): number | null {
	if (value == null || !Number.isFinite(value)) {
		return null;
	}
	return value;
}

function parseEmbedding(value: unknown): number[] | null {
	if (Array.isArray(value)) {
		const numbers = value
			.map((entry) => {
				if (typeof entry === "number" && Number.isFinite(entry)) {
					return entry;
				}
				if (typeof entry === "string") {
					const parsed = Number(entry);
					return Number.isFinite(parsed) ? parsed : null;
				}
				return null;
			})
			.filter((entry): entry is number => entry != null);
		return numbers.length > 0 ? numbers : null;
	}

	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			return null;
		}
		try {
			const parsed = JSON.parse(trimmed);
			return parseEmbedding(parsed);
		} catch {
			return null;
		}
	}

	return null;
}

function seedKeyFromQuery(query: BuildGroupQuery): string {
	return [
		`category:${query.category ?? "*"}`,
		`brand:${query.brand ?? "*"}`,
		`name:${query.namePattern ?? query.nameRegex ?? "*"}`,
		`chain:${query.chainSlug ?? "*"}`,
	].join("|");
}

function dominantValue(values: readonly (string | null)[]): string | null {
	const counts = new Map<string, number>();
	for (const value of values) {
		if (!value) {
			continue;
		}
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	let bestValue: string | null = null;
	let bestCount = -1;
	for (const [value, count] of counts.entries()) {
		if (count > bestCount) {
			bestValue = value;
			bestCount = count;
		}
	}
	return bestValue;
}

function toGroupItem(row: GroupRow): GroupItem {
	return {
		retailerItemId: row.retailer_item_id,
		rawName: row.raw_name,
		normalizedName:
			normalizeNullableString(row.normalized_name) ??
			row.raw_name.toLowerCase(),
		brand: normalizeNullableString(row.brand),
		category: normalizeNullableString(row.category),
		unit: normalizeNullableString(row.unit),
		unitQuantity: normalizeNullableString(row.unit_quantity),
		totalAmount: normalizeNullableNumber(row.total_amount),
		packAmount: normalizeNullableNumber(row.pack_amount),
		containerType: normalizeNullableString(row.container_type),
		chainSlug: normalizeNullableString(row.chain_slug),
		embedding: parseEmbedding(row.embedding),
	};
}

export async function buildGroupFromQuery(
	query: BuildGroupQuery,
): Promise<CandidateGroup> {
	const db = getDb();
	const whereParts = [sql`ri.merged_into_id IS NULL`];

	if (query.namePattern && query.namePattern.trim().length > 0) {
		whereParts.push(
			sql`LOWER(ri.name) LIKE ${maybeWrapLikePattern(query.namePattern.trim().toLowerCase())}`,
		);
	}

	if (query.nameRegex && query.nameRegex.trim().length > 0) {
		whereParts.push(
			sql`LOWER(ri.name) ~ ${query.nameRegex.trim().toLowerCase()}`,
		);
	}

	if (query.category && query.category.trim().length > 0) {
		whereParts.push(
			sql`LOWER(COALESCE(rif.normalized_category, ri.category, '')) LIKE ${maybeWrapLikePattern(query.category.trim().toLowerCase())}`,
		);
	}

	if (query.brand && query.brand.trim().length > 0) {
		whereParts.push(
			sql`LOWER(COALESCE(rif.extracted_brand, ri.brand, '')) LIKE ${maybeWrapLikePattern(query.brand.trim().toLowerCase())}`,
		);
	}

	if (query.chainSlug && query.chainSlug.trim().length > 0) {
		whereParts.push(sql`ri.chain_slug = ${query.chainSlug.trim()}`);
	}

	const whereClause =
		whereParts.length === 0 ? sql`TRUE` : sql.join(whereParts, sql` AND `);
	const orderByClause = query.randomSample
		? sql`random()`
		: sql`ri.created_at DESC`;
	const limit = Math.min(Math.max(query.limit ?? 120, 1), 300);

	const result = await db.execute(sql`
		SELECT
			ri.id AS retailer_item_id,
			ri.name AS raw_name,
			rif.normalized_name AS normalized_name,
			COALESCE(rif.extracted_brand, ri.brand) AS brand,
			COALESCE(rif.normalized_category, ri.category) AS category,
			COALESCE(rif.extracted_unit, ri.unit) AS unit,
			ri.unit_quantity AS unit_quantity,
			rif.total_amount AS total_amount,
			rif.pack_amount AS pack_amount,
			rif.container_type AS container_type,
			ri.chain_slug AS chain_slug,
			rif.embedding AS embedding
		FROM retailer_items ri
		LEFT JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
		WHERE ${whereClause}
		ORDER BY ${orderByClause}
		LIMIT ${limit}
	`);

	const rows = getRows<GroupRow>(result);
	const items = rows.map((row) => toGroupItem(row));
	const groupId = `listwise_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

	return {
		groupId,
		seedKey: seedKeyFromQuery(query),
		items,
		category: dominantValue(items.map((item) => item.category)),
		brand: dominantValue(items.map((item) => item.brand)),
	};
}
