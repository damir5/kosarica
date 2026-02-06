import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DatabaseType } from "@/db";
import {
	canonicalBarcodes,
	productLinks,
	productMatchCandidates,
	productMatchQueue,
	productMatchRejections,
	products,
} from "@/db/schema";
import {
	areSameBrandFamily,
	resolveBrand,
} from "@/lib/knowledge/brand-resolver";
import { extractProductAttributes } from "@/lib/knowledge/extractor";
import { getCachedCatalog, loadCatalog } from "@/lib/knowledge/loader";
import type { KnowledgeCatalog } from "@/lib/knowledge/types";
import {
	normalizeWhitespace,
	removeDiacritics,
} from "@/lib/matching/normalize";
import { getDb } from "@/utils/bindings";
import { generatePrefixedId } from "@/utils/id";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

type DbTransaction = Parameters<DatabaseType["transaction"]>[0] extends (
	transaction: infer Transaction,
) => Promise<unknown>
	? Transaction
	: never;

export interface BarcodeMatchingResult {
	runId: string;
	newProducts: number;
	newLinks: number;
	suspiciousFlags: number;
	skipped: number;
}

export interface TrigramMatchingResult {
	runId: string;
	processed: number;
	highConfidence: number;
	queuedForReview: number;
	noMatch: number;
}

export interface RetailerItemRow {
	id: string;
	name: string;
	brand: string | null;
	unit: string | null;
	unit_quantity: string | null;
	category: string | null;
	image_url: string | null;
	chain_slug: string | null;
	external_id: string | null;
	barcode: string;
	normalized_unit: string | null;
	normalized_quantity: number | null;
}

export interface RetailerItem {
	id: string;
	name: string;
	brand: string;
	unit: string;
	unitQuantity: string;
	category: string;
	imageUrl: string;
	chainSlug: string;
	externalId: string;
	barcode: string;
	normalizedUnit: string | null;
	normalizedQuantity: number | null;
}

export interface ProductCandidateRow {
	id: string;
	name: string;
	brand: string | null;
	category: string | null;
	unit: string | null;
	unit_quantity: string | null;
	image_url: string | null;
	canonical_key: string | null;
	sim_score: number | string;
	normalized_unit: string | null;
	normalized_quantity: number | null;
}

export interface Candidate {
	productId: string;
	similarity: number;
	product: {
		id: string;
		name: string;
		brand: string | null;
		category: string | null;
		unit: string | null;
		unitQuantity: string | null;
		imageUrl: string | null;
		canonicalKey: string | null;
		normalizedUnit: string | null;
		normalizedQuantity: number | null;
	};
}

const GENERIC_BRANDS = [
	"n/a",
	"nepoznato",
	"unknown",
	"-",
	"",
	"private label",
	"own brand",
];

export function isGenericBrand(brand: string): boolean {
	const normalized = normalizeWhitespace(brand).toLowerCase();
	if (GENERIC_BRANDS.includes(normalized)) {
		return true;
	}

	const catalog = getCachedCatalog();
	if (!catalog) {
		return false;
	}

	const resolved = resolveBrand(brand, catalog);
	return resolved?.isPrivateLabel ?? false;
}

function stringSimilarity(a: string, b: string): number {
	if (a === b) {
		return 1;
	}
	if (!a || !b) {
		return 0;
	}

	const setA = new Set(a);
	const setB = new Set(b);
	let intersection = 0;

	for (const char of setA) {
		if (setB.has(char)) {
			intersection += 1;
		}
	}

	const union = setA.size + setB.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

function normalizeUnit(unit: string, quantity: string): string {
	let normalizedUnit = normalizeWhitespace(unit).toLowerCase();
	const normalizedQuantity = normalizeWhitespace(quantity);

	const conversions: Record<string, string> = {
		l: "l",
		ltr: "l",
		lit: "l",
		ml: "ml",
		kg: "kg",
		g: "g",
		gr: "g",
		kom: "kom",
		pcs: "kom",
		pack: "kom",
	};

	if (normalizedUnit in conversions) {
		normalizedUnit = conversions[normalizedUnit];
	}

	const quantityValue = Number.parseFloat(normalizedQuantity);
	if (
		normalizedUnit === "ml" &&
		Number.isFinite(quantityValue) &&
		quantityValue >= 1000
	) {
		return `${quantityValue / 1000}l`;
	}
	if (
		normalizedUnit === "g" &&
		Number.isFinite(quantityValue) &&
		quantityValue >= 1000
	) {
		return `${quantityValue / 1000}kg`;
	}

	if (normalizedQuantity) {
		return `${normalizedQuantity}${normalizedUnit}`;
	}

	return normalizedUnit;
}

function normalizeForMatching(item: RetailerItem): string {
	const parts: string[] = [];

	if (item.name) {
		parts.push(removeDiacritics(item.name));
	}
	if (item.brand && !isGenericBrand(item.brand)) {
		parts.push(removeDiacritics(item.brand));
	}
	if (item.category) {
		parts.push(removeDiacritics(item.category));
	}
	if (item.unit || item.unitQuantity) {
		parts.push(`${item.unitQuantity}${item.unit}`.trim());
	}

	return normalizeWhitespace(parts.join(" ").toLowerCase());
}

function hashText(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function normalizeBarcode(barcode: string): string {
	const digits = barcode.replace(/[^0-9]/g, "");
	if (!digits) {
		return "";
	}
	if (/^0+$/.test(digits)) {
		return "";
	}
	if (digits.length === 13 && /^2[0-9]/.test(digits)) {
		return "";
	}
	let normalized = digits;
	if (normalized.length === 12) {
		normalized = `0${normalized}`;
	}
	if (normalized.length !== 13) {
		return normalized;
	}
	if (!validateEAN13CheckDigit(normalized)) {
		return "";
	}
	return normalized;
}

function validateEAN13CheckDigit(barcode: string): boolean {
	if (barcode.length !== 13) {
		return false;
	}
	let sum = 0;
	for (let i = 0; i < 12; i += 1) {
		const digit = Number.parseInt(barcode[i], 10);
		if (Number.isNaN(digit)) {
			return false;
		}
		sum += i % 2 === 0 ? digit : digit * 3;
	}
	const checkDigit = (10 - (sum % 10)) % 10;
	return Number.parseInt(barcode[12], 10) === checkDigit;
}

function checkSuspiciousBarcode(items: RetailerItem[]): string {
	if (items.length < 2) {
		return "";
	}

	const normalizedNames = items.map((item) =>
		removeDiacritics(item.name).toLowerCase(),
	);
	for (let i = 1; i < normalizedNames.length; i += 1) {
		const similarity = stringSimilarity(normalizedNames[0], normalizedNames[i]);
		if (similarity < 0.3) {
			return "suspicious_barcode_name_mismatch";
		}
	}

	const brands = new Set<string>();
	for (const item of items) {
		if (item.brand && !isGenericBrand(item.brand)) {
			brands.add(removeDiacritics(item.brand).toLowerCase());
		}
	}
	if (brands.size > 1) {
		return "suspicious_barcode_brand_conflict";
	}

	const units = new Set<string>();
	for (const item of items) {
		const normalized = normalizeUnit(item.unit, item.unitQuantity);
		if (normalized) {
			units.add(normalized);
		}
	}
	if (units.size > 1) {
		return "suspicious_barcode_unit_mismatch";
	}

	return "";
}

function pickBestItem(items: RetailerItem[]): RetailerItem {
	const chainPreference: Record<string, number> = {
		konzum: 10,
		konto: 9,
		plodine: 8,
		lidl: 7,
		kaufland: 6,
		spar: 5,
		interspar: 5,
	};

	let best = items[0];
	let bestScore = -1;

	for (const item of items) {
		let score = 0;
		if (item.imageUrl) {
			score += 100;
		}
		const pref = chainPreference[item.chainSlug.toLowerCase()];
		if (pref) {
			score += pref;
		}
		if (item.brand && !isGenericBrand(item.brand)) {
			score += 5;
		}
		if (item.category) {
			score += 3;
		}
		if (score > bestScore) {
			bestScore = score;
			best = item;
		}
	}

	return best;
}

export function hasPrivateLabelConflict(
	item: RetailerItem,
	candidate: Candidate,
): boolean {
	if (
		item.brand &&
		!isGenericBrand(item.brand) &&
		candidate.product.brand &&
		!isGenericBrand(candidate.product.brand)
	) {
		const catalog = getCachedCatalog();
		if (
			catalog &&
			areSameBrandFamily(item.brand, candidate.product.brand, catalog)
		) {
			return false;
		}

		const itemBrand = removeDiacritics(item.brand).toLowerCase();
		const candidateBrand = removeDiacritics(
			candidate.product.brand,
		).toLowerCase();
		return itemBrand !== candidateBrand;
	}
	return false;
}

function applyProductTypeBoost(
	candidates: Candidate[],
	extractedProductType: string | null,
): Candidate[] {
	if (!extractedProductType) {
		return candidates;
	}

	for (const candidate of candidates) {
		const candidateKey = candidate.product.canonicalKey;
		if (
			candidateKey &&
			(candidateKey === extractedProductType ||
				candidateKey.startsWith(`${extractedProductType}-`))
		) {
			candidate.similarity = Math.min(1, candidate.similarity + 0.1);
		}
	}

	candidates.sort((a, b) => b.similarity - a.similarity);
	return candidates;
}

export function checkUnitQuantityMismatch(
	item: { normalizedUnit: string | null; normalizedQuantity: number | null },
	candidate: {
		normalizedUnit: string | null;
		normalizedQuantity: number | null;
	},
): string {
	// If either side is missing unit info, don't flag
	if (!item.normalizedUnit || !candidate.normalizedUnit) {
		return "";
	}

	// Unit type mismatch (e.g. kg vs l)
	if (item.normalizedUnit !== candidate.normalizedUnit) {
		return "trgm_unit_type_mismatch";
	}

	// Same unit — check quantity ratio if both have quantities
	if (
		item.normalizedQuantity != null &&
		item.normalizedQuantity > 0 &&
		candidate.normalizedQuantity != null &&
		candidate.normalizedQuantity > 0
	) {
		const ratio = item.normalizedQuantity / candidate.normalizedQuantity;
		if (ratio > 2 || ratio < 0.5) {
			return "trgm_quantity_mismatch";
		}
	}

	return "";
}

export function mapRetailerItem(row: RetailerItemRow): RetailerItem {
	return {
		id: row.id,
		name: row.name,
		brand: row.brand ?? "",
		unit: row.unit ?? "",
		unitQuantity: row.unit_quantity ?? "",
		category: row.category ?? "",
		imageUrl: row.image_url ?? "",
		chainSlug: row.chain_slug ?? "",
		externalId: row.external_id ?? "",
		barcode: row.barcode,
		normalizedUnit: row.normalized_unit ?? null,
		normalizedQuantity: row.normalized_quantity ?? null,
	};
}

export function parseCandidateRows(rows: ProductCandidateRow[]): Candidate[] {
	return rows
		.map((row) => ({
			productId: row.id,
			similarity:
				typeof row.sim_score === "number"
					? row.sim_score
					: Number.parseFloat(row.sim_score),
			product: {
				id: row.id,
				name: row.name,
				brand: row.brand,
				category: row.category,
				unit: row.unit,
				unitQuantity: row.unit_quantity,
				imageUrl: row.image_url,
				canonicalKey: row.canonical_key ?? null,
				normalizedUnit: row.normalized_unit ?? null,
				normalizedQuantity: row.normalized_quantity ?? null,
			},
		}))
		.filter((candidate) => Number.isFinite(candidate.similarity));
}

export async function queueForReview(
	transaction: DbTransaction,
	retailerItemId: string,
): Promise<void> {
	await transaction
		.insert(productMatchQueue)
		.values({ retailerItemId })
		.onConflictDoNothing({ target: [productMatchQueue.retailerItemId] });
}

async function insertFlagCandidate(
	transaction: DbTransaction,
	retailerItemId: string,
	flag: string,
	matchType: "barcode" | "trgm",
): Promise<void> {
	await transaction
		.insert(productMatchCandidates)
		.values({
			retailerItemId,
			candidateProductId: null,
			similarity: null,
			matchType,
			rank: 1,
			flags: flag,
		})
		.onConflictDoUpdate({
			target: [
				productMatchCandidates.retailerItemId,
				productMatchCandidates.rank,
			],
			set: {
				candidateProductId: null,
				similarity: null,
				matchType,
				flags: flag,
			},
		});
}

export async function flagTopCandidate(
	transaction: DbTransaction,
	retailerItemId: string,
	flag: string,
): Promise<void> {
	await transaction
		.update(productMatchCandidates)
		.set({ flags: flag })
		.where(
			and(
				eq(productMatchCandidates.retailerItemId, retailerItemId),
				eq(productMatchCandidates.rank, 1),
			),
		);
}

export async function runBarcodeMatching(options?: {
	batchSize?: number;
}): Promise<BarcodeMatchingResult> {
	const batchSize = options?.batchSize ?? 100;
	const runId = generatePrefixedId("run");
	const db = getDb();

	const result = await db.execute(sql`
		WITH target_barcodes AS (
			SELECT DISTINCT rib.barcode
			FROM retailer_item_barcodes rib
			JOIN retailer_items ri ON ri.id = rib.retailer_item_id
			WHERE rib.barcode IS NOT NULL
				AND rib.barcode != ''
				AND ri.merged_into_id IS NULL
				AND NOT EXISTS (
					SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
				)
				AND NOT EXISTS (
					SELECT 1 FROM product_match_queue pmq
					WHERE pmq.retailer_item_id = ri.id
						AND pmq.status = 'pending'
				)
			ORDER BY rib.barcode
			LIMIT ${batchSize}
		)
		SELECT
			rib.barcode,
			ri.id,
			ri.name,
			ri.brand,
			ri.unit,
			ri.unit_quantity,
			ri.category,
			ri.image_url,
			ri.chain_slug,
			ri.external_id
		FROM retailer_item_barcodes rib
		JOIN retailer_items ri ON ri.id = rib.retailer_item_id
		JOIN target_barcodes tb ON tb.barcode = rib.barcode
		WHERE ri.merged_into_id IS NULL
		AND NOT EXISTS (
			SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
		)
		AND NOT EXISTS (
			SELECT 1 FROM product_match_queue pmq
			WHERE pmq.retailer_item_id = ri.id
				AND pmq.status = 'pending'
		)
		ORDER BY rib.barcode
	`);

	const rows = (
		Array.isArray(result)
			? result
			: ((result as { rows?: unknown[] }).rows ?? [])
	) as RetailerItemRow[];
	const barcodeItems = new Map<string, RetailerItem[]>();
	let skipped = 0;

	for (const row of rows) {
		const normalized = normalizeBarcode(row.barcode);
		if (!normalized) {
			skipped += 1;
			continue;
		}
		const items = barcodeItems.get(normalized) ?? [];
		items.push(mapRetailerItem(row));
		barcodeItems.set(normalized, items);
	}

	let newProducts = 0;
	let newLinks = 0;
	let suspiciousFlags = 0;

	for (const [barcode, items] of barcodeItems) {
		try {
			await db.transaction(async (tx) => {
				await tx.execute(
					sql`SELECT pg_advisory_xact_lock(hashtext(${barcode}))`,
				);

				const [existing] = await tx
					.select({ productId: canonicalBarcodes.productId })
					.from(canonicalBarcodes)
					.where(eq(canonicalBarcodes.barcode, barcode));

				let productId = existing?.productId ?? null;
				if (!productId) {
					const flag = checkSuspiciousBarcode(items);
					if (flag) {
						for (const item of items) {
							await queueForReview(tx, item.id);
							await insertFlagCandidate(tx, item.id, flag, "barcode");
						}
						suspiciousFlags += items.length;
						return;
					}

					const best = pickBestItem(items);
					const inserted = await tx
						.insert(products)
						.values({
							name: best.name,
							brand: best.brand || null,
							category: best.category || null,
							subcategory: null,
							unit: best.unit || null,
							unitQuantity: best.unitQuantity || null,
							imageUrl: best.imageUrl || null,
						})
						.returning({ id: products.id });

					productId = inserted[0]?.id ?? null;
					if (!productId) {
						throw new Error("Failed to create product for barcode matching");
					}

					if (existing) {
						await tx
							.update(canonicalBarcodes)
							.set({ productId })
							.where(eq(canonicalBarcodes.barcode, barcode));
					} else {
						await tx.insert(canonicalBarcodes).values({
							barcode,
							productId,
						});
					}
					newProducts += 1;
				}

				for (const item of items) {
					await tx
						.insert(productLinks)
						.values({
							productId,
							retailerItemId: item.id,
							confidence: "barcode",
						})
						.onConflictDoNothing({ target: [productLinks.retailerItemId] });
					newLinks += 1;
				}
			});
		} catch (error) {
			log.error("barcode processing failed", {
				barcode,
				error,
			});
		}
	}

	return {
		runId,
		newProducts,
		newLinks,
		suspiciousFlags,
		skipped,
	};
}

export async function runTrigramMatching(options?: {
	autoLinkThreshold?: number;
	reviewThreshold?: number;
	batchSize?: number;
	maxCandidates?: number;
	minSimilarity?: number;
}): Promise<TrigramMatchingResult> {
	const autoLinkThreshold = options?.autoLinkThreshold ?? 0.95;
	const reviewThreshold = options?.reviewThreshold ?? 0.8;
	const batchSize = options?.batchSize ?? 100;
	const maxCandidates = options?.maxCandidates ?? 5;
	const minSimilarity = options?.minSimilarity ?? 0.1;
	const runId = generatePrefixedId("run");
	let knowledgeCatalog: KnowledgeCatalog | null = null;
	try {
		knowledgeCatalog = await loadCatalog();
	} catch (error) {
		log.warn("Knowledge catalog unavailable for trigram matching", { error });
	}

	const db = getDb();
	const itemsResult = await db.execute(sql`
		SELECT
			ri.id,
			ri.name,
			ri.brand,
			ri.unit,
			ri.unit_quantity,
			ri.category,
			ri.image_url,
			ri.chain_slug,
			ri.external_id,
			'' as barcode,
			ri.normalized_unit,
			ri.normalized_quantity
		FROM retailer_items ri
		WHERE ri.merged_into_id IS NULL
		AND NOT EXISTS (
			SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
		)
		AND NOT EXISTS (
			SELECT 1 FROM product_match_queue pmq
			WHERE pmq.retailer_item_id = ri.id AND pmq.status = 'pending'
		)
		LIMIT ${batchSize}
	`);

	const itemRows = (
		Array.isArray(itemsResult)
			? itemsResult
			: ((itemsResult as { rows?: unknown[] }).rows ?? [])
	) as RetailerItemRow[];

	const result: TrigramMatchingResult = {
		runId,
		processed: 0,
		highConfidence: 0,
		queuedForReview: 0,
		noMatch: 0,
	};

	for (const row of itemRows) {
		const item = mapRetailerItem(row);
		const normalizedText = normalizeForMatching(item);
		const extractedProductType = knowledgeCatalog
			? extractProductAttributes(
					item.name,
					item.brand,
					item.category,
					knowledgeCatalog,
				).productType
			: null;
		if (!normalizedText) {
			result.noMatch += 1;
			continue;
		}
		const textHash = hashText(normalizedText);

		const itemCategory = item.category || null;
		const candidatesResult = await db.execute(sql`
			SELECT
				p.id,
				p.name,
				p.brand,
				p.category,
				p.unit,
				p.unit_quantity,
				p.image_url,
				p.canonical_key,
				p.normalized_unit,
				p.normalized_quantity,
				similarity(
					lower(concat_ws(' ', p.name, p.brand)),
					lower(${normalizedText})
				) as sim_score
			FROM products p
			WHERE similarity(
				lower(concat_ws(' ', p.name, p.brand)),
				lower(${normalizedText})
			) > ${minSimilarity}
			AND (
				p.category IS NULL
				OR ${itemCategory} IS NULL
				OR p.category = ${itemCategory}
			)
			ORDER BY sim_score DESC, p.name
			LIMIT ${maxCandidates}
		`);

		const candidateRows = (
			Array.isArray(candidatesResult)
				? candidatesResult
				: ((candidatesResult as { rows?: unknown[] }).rows ?? [])
		) as ProductCandidateRow[];
		const candidates = applyProductTypeBoost(
			parseCandidateRows(candidateRows),
			extractedProductType,
		);

		if (candidates.length === 0) {
			result.noMatch += 1;
			continue;
		}

		await db.transaction(async (tx) => {
			await tx
				.delete(productMatchCandidates)
				.where(eq(productMatchCandidates.retailerItemId, item.id));

			let rank = 1;
			for (const candidate of candidates) {
				const similarity = candidate.similarity.toFixed(6);
				await tx
					.insert(productMatchCandidates)
					.values({
						retailerItemId: item.id,
						candidateProductId: candidate.productId,
						similarity,
						matchType: "trgm",
						rank,
						matchingRunId: runId,
						modelVersion: "trgm-v1",
						normalizedTextHash: textHash,
					})
					.onConflictDoUpdate({
						target: [
							productMatchCandidates.retailerItemId,
							productMatchCandidates.rank,
						],
						set: {
							candidateProductId: candidate.productId,
							similarity,
							matchType: "trgm",
							matchingRunId: runId,
							modelVersion: "trgm-v1",
							normalizedTextHash: textHash,
						},
					});
				rank += 1;
			}

			const rejectedRows = await tx
				.select({ rejectedProductId: productMatchRejections.rejectedProductId })
				.from(productMatchRejections)
				.where(eq(productMatchRejections.retailerItemId, item.id));

			const rejectedSet = new Set(
				rejectedRows.map((row) => row.rejectedProductId),
			);

			const bestCandidate = candidates.find(
				(candidate) => !rejectedSet.has(candidate.productId),
			);

			if (!bestCandidate || bestCandidate.similarity < reviewThreshold) {
				result.noMatch += 1;
				return;
			}

			const unitQtyFlag = checkUnitQuantityMismatch(
				item,
				bestCandidate.product,
			);
			if (unitQtyFlag) {
				await queueForReview(tx, item.id);
				await flagTopCandidate(tx, item.id, unitQtyFlag);
				result.queuedForReview += 1;
				result.processed += 1;
				return;
			}

			if (hasPrivateLabelConflict(item, bestCandidate)) {
				await queueForReview(tx, item.id);
				await flagTopCandidate(tx, item.id, "trgm_private_label_conflict");
				result.queuedForReview += 1;
				result.processed += 1;
				return;
			}

			if (bestCandidate.similarity >= autoLinkThreshold) {
				await tx
					.insert(productLinks)
					.values({
						productId: bestCandidate.productId,
						retailerItemId: item.id,
						confidence: "ai",
					})
					.onConflictDoNothing({ target: [productLinks.retailerItemId] });
				result.highConfidence += 1;
				result.processed += 1;
				return;
			}

			await queueForReview(tx, item.id);
			await flagTopCandidate(tx, item.id, "trgm_uncertain");
			result.queuedForReview += 1;
			result.processed += 1;
		});
	}

	return result;
}

export type { SemanticMatchingResult } from "./semantic";
export { runSemanticMatching } from "./semantic";
export type { KnowledgeMatchingResult } from "./knowledge";
export { runKnowledgeMatching } from "./knowledge";
