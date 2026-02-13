import { sql } from "drizzle-orm";
import { getDb } from "@/utils/bindings";
import { createLogger } from "@/utils/logger";
import type { CandidateGroup, GroupItem } from "./listwise/types";

const log = createLogger("matching");

interface BlockingOptions {
	/** Max barcode groups to load (Tier 1). */
	barcodeLimit?: number;
	/** Min distinct chains for a barcode group to qualify. */
	barcodeMinChains?: number;
	/** Max deterministic groups to load (Tier 2). */
	deterministicLimit?: number;
	/** Max embedding groups to load (Tier 3). */
	embeddingLimit?: number;
	/** Cosine distance threshold for embedding neighbors. */
	embeddingDistanceThreshold?: number;
	/** Max neighbors per item in embedding tier. */
	embeddingNeighborCount?: number;
	/** Max lexical groups to load (Tier 4). */
	lexicalLimit?: number;
	/** Trigram similarity threshold for lexical tier. */
	lexicalSimilarityThreshold?: number;
	/** Overall limit on total groups returned. */
	totalGroupLimit?: number;
}

interface ItemRow {
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

function getRows<T>(result: unknown): T[] {
	if (Array.isArray(result)) {
		return result as T[];
	}
	return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

function normalizeNullableString(
	value: string | null | undefined,
): string | null {
	if (value == null) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableNumber(
	value: number | null | undefined,
): number | null {
	if (value == null || !Number.isFinite(value)) return null;
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
		if (trimmed.length === 0) return null;
		try {
			return parseEmbedding(JSON.parse(trimmed));
		} catch {
			return null;
		}
	}
	return null;
}

function toGroupItem(row: ItemRow): GroupItem {
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

class UnionFind {
	private parent = new Map<string, string>();

	find(x: string): string {
		if (!this.parent.has(x)) this.parent.set(x, x);
		let root = x;
		while (this.parent.get(root) !== root) {
			root = this.parent.get(root) as string;
		}
		// Path compression
		let current = x;
		while (current !== root) {
			const next = this.parent.get(current) as string;
			this.parent.set(current, root);
			current = next;
		}
		return root;
	}

	union(a: string, b: string): void {
		const rootA = this.find(a);
		const rootB = this.find(b);
		if (rootA !== rootB) this.parent.set(rootA, rootB);
	}
}

function dominantValue(values: readonly (string | null)[]): string | null {
	const counts = new Map<string, number>();
	for (const value of values) {
		if (!value) continue;
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

function distinctChains(items: readonly GroupItem[]): number {
	const chains = new Set<string>();
	for (const item of items) {
		if (item.chainSlug) chains.add(item.chainSlug);
	}
	return chains.size;
}

function buildGroup(
	groupId: string,
	seedKey: string,
	items: GroupItem[],
): CandidateGroup {
	return {
		groupId,
		seedKey,
		items,
		category: dominantValue(items.map((item) => item.category)),
		brand: dominantValue(items.map((item) => item.brand)),
	};
}

// ---------------------------------------------------------------------------
// Tier 1: Barcode groups
// ---------------------------------------------------------------------------
async function loadBarcodeGroups(params: {
	limit: number;
	minChains: number;
	excludeItemIds: Set<string>;
}): Promise<CandidateGroup[]> {
	const db = getDb();
	const result = await db.execute(sql`
		WITH barcode_clusters AS (
			SELECT
				rib.barcode,
				COUNT(DISTINCT ri.chain_slug) AS chain_count,
				COUNT(ri.id) AS item_count
			FROM retailer_item_barcodes rib
			JOIN retailer_items ri ON ri.id = rib.retailer_item_id
			WHERE ri.merged_into_id IS NULL
				AND rib.barcode_class NOT IN ('variable_weight', 'internal_code')
			GROUP BY rib.barcode
			HAVING COUNT(DISTINCT ri.chain_slug) >= ${params.minChains}
				AND COUNT(ri.id) >= 2
			ORDER BY COUNT(DISTINCT ri.chain_slug) DESC, COUNT(ri.id) DESC
			LIMIT ${params.limit}
		)
		SELECT
			rib.barcode AS barcode,
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
		FROM barcode_clusters bc
		JOIN retailer_item_barcodes rib ON rib.barcode = bc.barcode
		JOIN retailer_items ri ON ri.id = rib.retailer_item_id
		LEFT JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
		WHERE ri.merged_into_id IS NULL
		ORDER BY bc.barcode, ri.chain_slug
	`);

	const rows = getRows<ItemRow & { barcode: string }>(result);
	const grouped = new Map<string, (ItemRow & { barcode: string })[]>();
	for (const row of rows) {
		if (params.excludeItemIds.has(row.retailer_item_id)) continue;
		if (!grouped.has(row.barcode)) {
			grouped.set(row.barcode, []);
		}
		grouped.get(row.barcode)?.push(row);
	}

	const groups: CandidateGroup[] = [];
	for (const [barcode, items] of grouped.entries()) {
		const groupItems = items.map((row) => toGroupItem(row));
		if (groupItems.length < 2 || distinctChains(groupItems) < 2) continue;
		groups.push(
			buildGroup(`barcode_${barcode}`, `barcode:${barcode}`, groupItems),
		);
	}
	return groups;
}

// ---------------------------------------------------------------------------
// Tier 2: Deterministic key groups
// ---------------------------------------------------------------------------
async function loadDeterministicGroups(params: {
	limit: number;
	excludeItemIds: Set<string>;
}): Promise<CandidateGroup[]> {
	const db = getDb();
	const result = await db.execute(sql`
		WITH keyed AS (
			SELECT
				ri.id AS retailer_item_id,
				ri.name AS raw_name,
				rif.normalized_name,
				COALESCE(rif.extracted_brand, ri.brand) AS brand,
				COALESCE(rif.normalized_category, ri.category) AS category,
				COALESCE(rif.extracted_unit, ri.unit) AS unit,
				ri.unit_quantity AS unit_quantity,
				rif.total_amount AS total_amount,
				rif.pack_amount AS pack_amount,
				rif.container_type AS container_type,
				ri.chain_slug AS chain_slug,
				rif.embedding AS embedding,
				LOWER(COALESCE(rif.extracted_brand, ri.brand, ''))
					|| '|' || LOWER(COALESCE(rif.everyday_name, ''))
					|| '|' || LOWER(COALESCE(rif.extracted_unit, ri.unit, ''))
					|| '|' || COALESCE(ROUND(rif.total_amount::numeric, -1)::text, '')
					|| '|' || LOWER(COALESCE(rif.container_type, ''))
				AS deterministic_key
			FROM retailer_items ri
			JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
			WHERE ri.merged_into_id IS NULL
				AND rif.everyday_name IS NOT NULL
				AND rif.everyday_name <> ''
		),
		grouped_keys AS (
			SELECT deterministic_key
			FROM keyed
			WHERE deterministic_key <> '||||'
			GROUP BY deterministic_key
			HAVING COUNT(DISTINCT chain_slug) >= 2
			ORDER BY COUNT(*) DESC
			LIMIT ${params.limit}
		)
		SELECT
			k.retailer_item_id,
			k.raw_name,
			k.normalized_name,
			k.brand,
			k.category,
			k.unit,
			k.unit_quantity,
			k.total_amount,
			k.pack_amount,
			k.container_type,
			k.chain_slug,
			k.embedding,
			k.deterministic_key
		FROM keyed k
		JOIN grouped_keys gk ON gk.deterministic_key = k.deterministic_key
		ORDER BY k.deterministic_key, k.chain_slug
	`);

	const rows = getRows<ItemRow & { deterministic_key: string }>(result);
	const grouped = new Map<
		string,
		(ItemRow & { deterministic_key: string })[]
	>();
	for (const row of rows) {
		if (params.excludeItemIds.has(row.retailer_item_id)) continue;
		if (!grouped.has(row.deterministic_key)) {
			grouped.set(row.deterministic_key, []);
		}
		grouped.get(row.deterministic_key)?.push(row);
	}

	const groups: CandidateGroup[] = [];
	for (const [key, items] of grouped.entries()) {
		const groupItems = items.map((row) => toGroupItem(row));
		if (groupItems.length < 2 || distinctChains(groupItems) < 2) continue;
		const safeKey = key.replace(/[^a-z0-9|_-]/g, "_").slice(0, 80);
		groups.push(
			buildGroup(
				`det_${safeKey}_${items.length}`,
				`deterministic:${key}`,
				groupItems,
			),
		);
	}
	return groups;
}

// ---------------------------------------------------------------------------
// Tier 3: Embedding clusters (nearest neighbors within same productType)
// ---------------------------------------------------------------------------
async function loadEmbeddingGroups(params: {
	limit: number;
	distanceThreshold: number;
	neighborCount: number;
	excludeItemIds: Set<string>;
}): Promise<CandidateGroup[]> {
	const db = getDb();

	// Find items with embeddings that haven't been grouped yet, get their
	// nearest neighbors within the same product_type, then form connected
	// components.
	const excludeArray =
		params.excludeItemIds.size > 0
			? Array.from(params.excludeItemIds)
			: ["__none__"];
	// Embed array inline to avoid Drizzle parameterizing each element (ROW limit 1664)
	const excludeSql = `ARRAY[${excludeArray.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")}]::text[]`;

	const result = await db.execute(sql`
		WITH source_items AS (
			SELECT
				ri.id AS retailer_item_id,
				ri.name AS raw_name,
				rif.normalized_name,
				COALESCE(rif.extracted_brand, ri.brand) AS brand,
				COALESCE(rif.normalized_category, ri.category) AS category,
				COALESCE(rif.extracted_unit, ri.unit) AS unit,
				ri.unit_quantity AS unit_quantity,
				rif.total_amount AS total_amount,
				rif.pack_amount AS pack_amount,
				rif.container_type AS container_type,
				ri.chain_slug AS chain_slug,
				rif.embedding AS embedding,
				rif.product_type
			FROM retailer_items ri
			JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
			WHERE ri.merged_into_id IS NULL
				AND rif.embedding IS NOT NULL
				AND rif.product_type IS NOT NULL
				AND rif.product_type <> ''
				AND NOT ri.id = ANY(${sql.raw(excludeSql)})
			ORDER BY random()
			LIMIT ${params.limit * 3}
		),
		pairs AS (
			SELECT
				s.retailer_item_id AS source_id,
				t.retailer_item_id AS target_id,
				(1 - (s.embedding <=> t.embedding))::real AS similarity
			FROM source_items s
			JOIN LATERAL (
				SELECT
					rif2.retailer_item_id,
					rif2.embedding
				FROM retailer_item_features rif2
				JOIN retailer_items ri2 ON ri2.id = rif2.retailer_item_id
				WHERE ri2.merged_into_id IS NULL
					AND rif2.embedding IS NOT NULL
					AND rif2.product_type = s.product_type
					AND rif2.retailer_item_id <> s.retailer_item_id
					AND NOT ri2.id = ANY(${sql.raw(excludeSql)})
				ORDER BY rif2.embedding <=> s.embedding
				LIMIT ${params.neighborCount}
			) t ON true
			WHERE (1 - (s.embedding <=> t.embedding)) >= ${1 - params.distanceThreshold}
		)
		SELECT DISTINCT source_id, target_id, similarity
		FROM pairs
		ORDER BY similarity DESC
	`);

	const pairRows = getRows<{
		source_id: string;
		target_id: string;
		similarity: number;
	}>(result);

	if (pairRows.length === 0) return [];

	// Union-Find to form connected components
	const uf = new UnionFind();

	for (const pair of pairRows) {
		uf.union(pair.source_id, pair.target_id);
	}

	// Group items by their connected component root
	const allItemIds = new Set<string>();
	for (const pair of pairRows) {
		allItemIds.add(pair.source_id);
		allItemIds.add(pair.target_id);
	}

	const components = new Map<string, Set<string>>();
	for (const itemId of allItemIds) {
		const root = uf.find(itemId);
		if (!components.has(root)) components.set(root, new Set());
		components.get(root)?.add(itemId);
	}

	// Load full item data for the grouped items
	const itemIdsToLoad = Array.from(allItemIds);
	if (itemIdsToLoad.length === 0) return [];

	const itemResult = await db.execute(sql`
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
		WHERE ri.id = ANY(${itemIdsToLoad}::text[])
	`);

	const itemMap = new Map<string, GroupItem>();
	for (const row of getRows<ItemRow>(itemResult)) {
		itemMap.set(row.retailer_item_id, toGroupItem(row));
	}

	const groups: CandidateGroup[] = [];
	let idx = 0;
	for (const memberIds of components.values()) {
		if (memberIds.size < 2) continue;
		const items = Array.from(memberIds)
			.map((id) => itemMap.get(id))
			.filter((item): item is GroupItem => item != null);
		if (items.length < 2 || distinctChains(items) < 2) continue;
		groups.push(
			buildGroup(`emb_cluster_${idx}`, `embedding:cluster_${idx}`, items),
		);
		idx += 1;
		if (idx >= params.limit) break;
	}
	return groups;
}

// ---------------------------------------------------------------------------
// Tier 4: Lexical buckets (trigram similarity within same productType)
// ---------------------------------------------------------------------------
async function loadLexicalGroups(params: {
	limit: number;
	similarityThreshold: number;
	excludeItemIds: Set<string>;
}): Promise<CandidateGroup[]> {
	const db = getDb();

	const excludeArray =
		params.excludeItemIds.size > 0
			? Array.from(params.excludeItemIds)
			: ["__none__"];
	const excludeSql = `ARRAY[${excludeArray.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")}]::text[]`;

	const result = await db.execute(sql`
		WITH source_items AS (
			SELECT
				ri.id AS retailer_item_id,
				ri.name AS raw_name,
				rif.normalized_name,
				COALESCE(rif.extracted_brand, ri.brand) AS brand,
				COALESCE(rif.normalized_category, ri.category) AS category,
				COALESCE(rif.extracted_unit, ri.unit) AS unit,
				ri.unit_quantity AS unit_quantity,
				rif.total_amount AS total_amount,
				rif.pack_amount AS pack_amount,
				rif.container_type AS container_type,
				ri.chain_slug AS chain_slug,
				rif.embedding AS embedding,
				rif.product_type
			FROM retailer_items ri
			JOIN retailer_item_features rif ON rif.retailer_item_id = ri.id
			WHERE ri.merged_into_id IS NULL
				AND rif.normalized_name IS NOT NULL
				AND rif.normalized_name <> ''
				AND rif.product_type IS NOT NULL
				AND rif.product_type <> ''
				AND NOT ri.id = ANY(${sql.raw(excludeSql)})
			ORDER BY random()
			LIMIT ${params.limit * 5}
		),
		pairs AS (
			SELECT
				s.retailer_item_id AS source_id,
				t.retailer_item_id AS target_id,
				similarity(s.normalized_name, t.normalized_name)::real AS trigram_sim
			FROM source_items s
			JOIN LATERAL (
				SELECT
					rif2.retailer_item_id,
					rif2.normalized_name
				FROM retailer_item_features rif2
				JOIN retailer_items ri2 ON ri2.id = rif2.retailer_item_id
				WHERE ri2.merged_into_id IS NULL
					AND rif2.normalized_name IS NOT NULL
					AND rif2.normalized_name <> ''
					AND rif2.product_type = s.product_type
					AND rif2.retailer_item_id <> s.retailer_item_id
					AND NOT ri2.id = ANY(${sql.raw(excludeSql)})
				ORDER BY rif2.normalized_name <-> s.normalized_name
				LIMIT 10
			) t ON true
			WHERE similarity(s.normalized_name, t.normalized_name) >= ${params.similarityThreshold}
		)
		SELECT DISTINCT source_id, target_id, trigram_sim
		FROM pairs
		ORDER BY trigram_sim DESC
	`);

	const pairRows = getRows<{
		source_id: string;
		target_id: string;
		trigram_sim: number;
	}>(result);

	if (pairRows.length === 0) return [];

	// Union-Find for connected components
	const uf = new UnionFind();

	for (const pair of pairRows) {
		uf.union(pair.source_id, pair.target_id);
	}

	const allItemIds = new Set<string>();
	for (const pair of pairRows) {
		allItemIds.add(pair.source_id);
		allItemIds.add(pair.target_id);
	}

	const components = new Map<string, Set<string>>();
	for (const itemId of allItemIds) {
		const root = uf.find(itemId);
		if (!components.has(root)) components.set(root, new Set());
		components.get(root)?.add(itemId);
	}

	// Load full item data
	const itemIdsToLoad = Array.from(allItemIds);
	if (itemIdsToLoad.length === 0) return [];

	const itemResult = await db.execute(sql`
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
		WHERE ri.id = ANY(${itemIdsToLoad}::text[])
	`);

	const itemMap = new Map<string, GroupItem>();
	for (const row of getRows<ItemRow>(itemResult)) {
		itemMap.set(row.retailer_item_id, toGroupItem(row));
	}

	const groups: CandidateGroup[] = [];
	let idx = 0;
	for (const memberIds of components.values()) {
		if (memberIds.size < 2) continue;
		const items = Array.from(memberIds)
			.map((id) => itemMap.get(id))
			.filter((item): item is GroupItem => item != null);
		if (items.length < 2 || distinctChains(items) < 2) continue;
		groups.push(
			buildGroup(`lex_bucket_${idx}`, `lexical:bucket_${idx}`, items),
		);
		idx += 1;
		if (idx >= params.limit) break;
	}
	return groups;
}

// ---------------------------------------------------------------------------
// Orchestrator: generate candidate groups across all tiers with dedup
// ---------------------------------------------------------------------------

export interface GenerateCandidateGroupsOptions extends BlockingOptions {}

export interface GenerateCandidateGroupsResult {
	groups: CandidateGroup[];
	stats: {
		barcodeGroups: number;
		deterministicGroups: number;
		embeddingGroups: number;
		lexicalGroups: number;
		totalItems: number;
		deduplicatedItems: number;
	};
}

export async function generateCandidateGroups(
	options: GenerateCandidateGroupsOptions = {},
): Promise<GenerateCandidateGroupsResult> {
	const barcodeLimit = options.barcodeLimit ?? 200;
	const barcodeMinChains = options.barcodeMinChains ?? 2;
	const deterministicLimit = options.deterministicLimit ?? 200;
	const embeddingLimit = options.embeddingLimit ?? 100;
	const embeddingDistanceThreshold = options.embeddingDistanceThreshold ?? 0.15;
	const embeddingNeighborCount = options.embeddingNeighborCount ?? 10;
	const lexicalLimit = options.lexicalLimit ?? 100;
	const lexicalSimilarityThreshold = options.lexicalSimilarityThreshold ?? 0.4;
	const totalGroupLimit = options.totalGroupLimit ?? 500;

	const assignedItems = new Set<string>();
	const allGroups: CandidateGroup[] = [];

	function collectItems(groups: CandidateGroup[]): void {
		for (const group of groups) {
			for (const item of group.items) {
				assignedItems.add(item.retailerItemId);
			}
		}
	}

	// Tier 1: Barcode
	log.info("Blocking Tier 1: loading barcode groups", {
		limit: barcodeLimit,
		minChains: barcodeMinChains,
	});
	const barcodeGroups = await loadBarcodeGroups({
		limit: barcodeLimit,
		minChains: barcodeMinChains,
		excludeItemIds: assignedItems,
	});
	allGroups.push(...barcodeGroups);
	collectItems(barcodeGroups);

	// Tier 2: Deterministic
	log.info("Blocking Tier 2: loading deterministic groups", {
		limit: deterministicLimit,
		excludedItems: assignedItems.size,
	});
	const deterministicGroups = await loadDeterministicGroups({
		limit: deterministicLimit,
		excludeItemIds: assignedItems,
	});
	allGroups.push(...deterministicGroups);
	collectItems(deterministicGroups);

	// Tier 3: Embedding
	log.info("Blocking Tier 3: loading embedding groups", {
		limit: embeddingLimit,
		distanceThreshold: embeddingDistanceThreshold,
		excludedItems: assignedItems.size,
	});
	const embeddingGroups = await loadEmbeddingGroups({
		limit: embeddingLimit,
		distanceThreshold: embeddingDistanceThreshold,
		neighborCount: embeddingNeighborCount,
		excludeItemIds: assignedItems,
	});
	allGroups.push(...embeddingGroups);
	collectItems(embeddingGroups);

	// Tier 4: Lexical
	log.info("Blocking Tier 4: loading lexical groups", {
		limit: lexicalLimit,
		similarityThreshold: lexicalSimilarityThreshold,
		excludedItems: assignedItems.size,
	});
	const lexicalGroups = await loadLexicalGroups({
		limit: lexicalLimit,
		similarityThreshold: lexicalSimilarityThreshold,
		excludeItemIds: assignedItems,
	});
	allGroups.push(...lexicalGroups);
	collectItems(lexicalGroups);

	// Apply total group limit
	const limitedGroups = allGroups.slice(0, totalGroupLimit);

	const stats = {
		barcodeGroups: barcodeGroups.length,
		deterministicGroups: deterministicGroups.length,
		embeddingGroups: embeddingGroups.length,
		lexicalGroups: lexicalGroups.length,
		totalItems: assignedItems.size,
		deduplicatedItems: assignedItems.size,
	};

	log.info("Blocking complete", {
		totalGroups: limitedGroups.length,
		...stats,
	});

	return { groups: limitedGroups, stats };
}
