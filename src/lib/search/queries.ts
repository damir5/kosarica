import { type SQL, sql } from "drizzle-orm";
import { getDb } from "@/utils/bindings";
import type {
	AutocompleteResult,
	FullSearchResult,
	SearchEntityType,
	SearchFilters,
} from "./types";

const VALID_ENTITY_TYPES = new Set<SearchEntityType>([
	"product",
	"item",
	"store",
]);

function escapeLikePattern(input: string): string {
	return input.replace(/[%_\\]/g, "\\$&");
}

function validateEntityTypes(types: string[]): SearchEntityType[] {
	return types.filter((type) =>
		VALID_ENTITY_TYPES.has(type as SearchEntityType),
	) as SearchEntityType[];
}

function getRows<T>(result: unknown): T[] {
	if (Array.isArray(result)) {
		return result as T[];
	}
	return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

function parseWeightEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) {
		return fallback;
	}
	const parsed = Number.parseFloat(raw);
	if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
		return fallback;
	}
	return parsed;
}

const SEARCH_WEIGHT_FTS = parseWeightEnv("SEARCH_WEIGHT_FTS", 0.7);
const SEARCH_WEIGHT_TRIGRAM = parseWeightEnv("SEARCH_WEIGHT_TRIGRAM", 0.3);

function buildFilterConditions(
	filters?: SearchFilters,
	aliased = false,
): SQL[] {
	const filterConditions: SQL[] = [];

	if (filters?.entityTypes?.length) {
		const validTypes = validateEntityTypes(filters.entityTypes);
		if (validTypes.length > 0) {
			filterConditions.push(
				aliased
					? sql`s.entity_type = ANY(${validTypes})`
					: sql`entity_type = ANY(${validTypes})`,
			);
		}
	}

	if (filters?.chainSlug) {
		filterConditions.push(
			aliased
				? sql`s.chain_slug = ${filters.chainSlug}`
				: sql`chain_slug = ${filters.chainSlug}`,
		);
	}

	if (filters?.category) {
		filterConditions.push(
			aliased
				? sql`s.category = ${filters.category}`
				: sql`category = ${filters.category}`,
		);
	}

	return filterConditions;
}

function buildScoreExpression(
	ftsWeight: number,
	trigramWeight: number,
): SQL {
	return sql`(
		COALESCE(ts_rank_cd(s.search_vector, q.tsq, 32), 0) * ${ftsWeight} +
		GREATEST(
			similarity(s.title_normalized, q.nq),
			similarity(s.body_normalized, q.nq) * 0.5
		) * ${trigramWeight}
	)`;
}

export async function autocompleteSearch(
	query: string,
	limit = 10,
	filters?: SearchFilters,
): Promise<AutocompleteResult[]> {
	const normalizedQuery = query.toLowerCase().trim();
	if (normalizedQuery.length < 2) {
		return [];
	}

	const db = getDb();
	const prefixPattern = `${escapeLikePattern(normalizedQuery)}%`;
	const conditions: SQL[] = [
		sql`(
				s.autocomplete_text LIKE ${prefixPattern} ESCAPE '\\'
				OR similarity(s.autocomplete_text, ${normalizedQuery}) > 0.3
			)`,
		...buildFilterConditions(filters, true),
	];
	const whereClause = sql.join(conditions, sql` AND `);

	const resultsRaw = await db.execute(sql`
		SELECT
			id,
			entity_type as "entityType",
			entity_id as "entityId",
			title,
			subtitle,
			image_url as "imageUrl"
		FROM search_index s
		WHERE ${whereClause}
		ORDER BY
			CASE WHEN s.autocomplete_text LIKE ${prefixPattern} ESCAPE '\\' THEN 0 ELSE 1 END,
			similarity(s.autocomplete_text, ${normalizedQuery}) DESC,
			title
		LIMIT ${limit}
	`);

	return getRows<AutocompleteResult>(resultsRaw);
}

export async function fullSearch(
	query: string,
	limit = 20,
	offset = 0,
	filters?: SearchFilters,
): Promise<{ results: FullSearchResult[]; total: number }> {
	const normalizedQuery = query.toLowerCase().trim();
	if (normalizedQuery.length < 2) {
		return { results: [], total: 0 };
	}

	const db = getDb();
	const filterConditions = buildFilterConditions(filters, true);
	const filterClause =
		filterConditions.length > 0
			? sql`AND ${sql.join(filterConditions, sql` AND `)}`
			: sql``;

	const ftsWeight = SEARCH_WEIGHT_FTS;
	const trigramWeight = SEARCH_WEIGHT_TRIGRAM;
	const scoreExpression = buildScoreExpression(
		ftsWeight,
		trigramWeight,
	);

	const searchQuery = sql`
		WITH q AS (
			SELECT
				websearch_to_tsquery('simple', ${normalizedQuery}) AS tsq,
				${normalizedQuery} AS nq
		),
		search_results AS (
			SELECT
				s.id,
				s.entity_type,
				s.entity_id,
				s.chain_slug,
				s.category,
					s.title,
					s.subtitle,
					s.body,
					s.image_url,
					${scoreExpression} as score,
					ts_headline('simple', s.title, q.tsq,
						'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15'
					) as title_highlight,
				ts_headline('simple', COALESCE(s.body, ''), q.tsq,
					'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15'
				) as body_highlight
			FROM search_index s
			CROSS JOIN q
			WHERE (
				s.search_vector @@ q.tsq
				OR s.title_normalized % q.nq
				OR s.body_normalized % q.nq
			)
			${filterClause}
		)
		SELECT
			id,
			entity_type as "entityType",
			entity_id as "entityId",
			chain_slug as "chainSlug",
			category,
			title,
			subtitle,
			body,
			image_url as "imageUrl",
			score,
			title_highlight as "titleHighlight",
			body_highlight as "bodyHighlight"
		FROM search_results
		WHERE score > 0.05
		ORDER BY score DESC
		LIMIT ${limit}
		OFFSET ${offset}
	`;

	const countQuery = sql`
		WITH q AS (
			SELECT
				websearch_to_tsquery('simple', ${normalizedQuery}) AS tsq,
				${normalizedQuery} AS nq
			)
			SELECT COUNT(*) as total
			FROM (
				SELECT ${scoreExpression} as score
				FROM search_index s
				CROSS JOIN q
			WHERE (
				s.search_vector @@ q.tsq
				OR s.title_normalized % q.nq
				OR s.body_normalized % q.nq
			)
			${filterClause}
		) scored
		WHERE scored.score > 0.05
	`;

	type RawResult = {
		id: string;
		entityType: SearchEntityType;
		entityId: string;
		chainSlug: string | null;
		category: string | null;
		title: string;
		subtitle: string | null;
		body: string | null;
		imageUrl: string | null;
		score: number;
		titleHighlight: string | null;
		bodyHighlight: string | null;
	};

	const [resultsRaw, countRaw] = await Promise.all([
		db.execute(searchQuery),
		db.execute(countQuery),
	]);

	const rows = getRows<RawResult>(resultsRaw);
	const countRows = getRows<{ total: string | number }>(countRaw);
	const total = Number(countRows[0]?.total ?? 0);

	const results: FullSearchResult[] = rows.map((row) => ({
		id: row.id,
		entityType: row.entityType,
		entityId: row.entityId,
		chainSlug: row.chainSlug,
		category: row.category,
		title: row.title,
		subtitle: row.subtitle,
		body: row.body,
		imageUrl: row.imageUrl,
		score: Number(row.score),
		highlights: {
			title: row.titleHighlight,
			body: row.bodyHighlight,
		},
	}));

	return { results, total };
}
