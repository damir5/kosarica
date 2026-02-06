import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/db";
import { productAliases, productLinks, productRelations, products } from "@/db/schema";
import { loadCatalog } from "@/lib/knowledge/loader";
import type { ProductDefinition } from "@/lib/knowledge/types";
import { ensureVariantRelation } from "@/lib/matching/knowledge";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

interface ApplyOptions {
	dryRun: boolean;
	category: string | null;
	catalogDir: string | null;
}

interface ApplySummary {
	productsCreated: number;
	linksCreated: number;
	aliasesCreated: number;
	relationsCreated: number;
}

async function main() {
	loadRuntimeEnv();
	const options = parseArgs(process.argv.slice(2));
	const db = getDatabase();
	const catalog = await loadCatalog(options.catalogDir ?? undefined);
	const summary: ApplySummary = {
		productsCreated: 0,
		linksCreated: 0,
		aliasesCreated: 0,
		relationsCreated: 0,
	};

	const definitions = [...catalog.productsByCanonicalKey.values()].filter(
		(definition) => !options.category || definition.category === options.category,
	);

	const canonicalKeyToProductId = new Map<string, string>();

	for (const definition of definitions) {
		const existing = await db
			.select({ id: products.id })
			.from(products)
			.where(eq(products.canonicalKey, definition.canonical_key))
			.limit(1);

		if (existing[0]?.id) {
			canonicalKeyToProductId.set(definition.canonical_key, existing[0].id);
			continue;
		}

		if (options.dryRun) {
			summary.productsCreated += 1;
			canonicalKeyToProductId.set(
				definition.canonical_key,
				`dry:${definition.canonical_key}`,
			);
			continue;
		}

		const inserted = await db
			.insert(products)
			.values(buildProductInsert(definition))
			.returning({ id: products.id });
		const productId = inserted[0]?.id;
		if (!productId) {
			throw new Error(
				`Failed to create product for canonical key ${definition.canonical_key}`,
			);
		}
		canonicalKeyToProductId.set(definition.canonical_key, productId);
		summary.productsCreated += 1;
	}

	for (const equivalence of catalog.equivalencesVerified) {
		const definition = catalog.productsByCanonicalKey.get(equivalence.canonicalKey);
		if (!definition) {
			continue;
		}
		if (options.category && definition.category !== options.category) {
			continue;
		}

		const productId = canonicalKeyToProductId.get(equivalence.canonicalKey);
		if (!productId) {
			continue;
		}

		for (const item of equivalence.items) {
			if (options.dryRun) {
				const dryCount = await countUnlinkedMatches(item.chain, item.name_pattern);
				summary.linksCreated += dryCount;
				const aliasExists = await checkAliasExistsByCanonicalKey(
					equivalence.canonicalKey,
					item.name_pattern,
				);
				if (!aliasExists) {
					summary.aliasesCreated += 1;
				}
				continue;
			}

			const aliasInserted = await insertAliasIfMissing(
				productId,
				item.name_pattern,
				`knowledge-equivalence:${item.chain}`,
			);
			if (aliasInserted) {
				summary.aliasesCreated += 1;
			}

			const matchedItemRows = await db.execute(sql`
				SELECT ri.id
				FROM retailer_items ri
				WHERE ri.chain_slug = ${item.chain}
				AND ri.merged_into_id IS NULL
				AND lower(ri.name) LIKE lower(${`%${escapeLikePattern(item.name_pattern)}%`})
			`);
			const matchedItems = (
				Array.isArray(matchedItemRows)
					? matchedItemRows
					: ((matchedItemRows as { rows?: unknown[] }).rows ?? [])
			) as Array<{ id: string }>;

			for (const matched of matchedItems) {
				const inserted = await db
					.insert(productLinks)
					.values({
						productId,
						retailerItemId: matched.id,
						confidence: "knowledge",
					})
					.onConflictDoNothing({ target: [productLinks.retailerItemId] })
					.returning({ id: productLinks.id });
				if (inserted.length > 0) {
					summary.linksCreated += 1;
				}
			}
		}
	}

	const byType = new Map<string, string[]>();
	for (const [canonicalKey, productId] of canonicalKeyToProductId) {
		if (productId.startsWith("dry:")) {
			continue;
		}
		const type = getCanonicalType(canonicalKey);
		if (!type) {
			continue;
		}
		const bucket = byType.get(type) ?? [];
		bucket.push(productId);
		byType.set(type, bucket);
	}

	for (const productIds of byType.values()) {
		for (let i = 0; i < productIds.length; i += 1) {
			for (let j = i + 1; j < productIds.length; j += 1) {
				const a = productIds[i];
				const b = productIds[j];
				if (options.dryRun) {
					const exists = await relationExists(a, b);
					if (!exists) {
						summary.relationsCreated += 1;
					}
					continue;
				}

				const before = await relationExists(a, b);
				if (!before) {
					await db.transaction(async (tx) => {
						await ensureVariantRelation(tx, a, b);
					});
					summary.relationsCreated += 1;
				}
			}
		}
	}

	if (options.dryRun) {
		console.log("Knowledge apply dry-run summary:");
	} else {
		console.log("Knowledge apply summary:");
	}
	console.log(`Products created: ${summary.productsCreated}`);
	console.log(`Links created: ${summary.linksCreated}`);
	console.log(`Aliases created: ${summary.aliasesCreated}`);
	console.log(`Variant relations created: ${summary.relationsCreated}`);
}

function loadRuntimeEnv(): void {
	if (process.env.DATABASE_URL) {
		return;
	}

	const envCandidates: string[] = [];
	if (process.env.NODE_ENV) {
		envCandidates.push(`.env.${process.env.NODE_ENV}`);
	}
	envCandidates.push(".env.test", ".env.development", ".env");

	for (const file of envCandidates) {
		if (!existsSync(file)) {
			continue;
		}
		loadDotenv({ path: file });
		if (process.env.DATABASE_URL) {
			return;
		}
	}
}

function parseArgs(argv: string[]): ApplyOptions {
	return {
		dryRun: argv.includes("--dry-run"),
		category: getArgValue(argv, "--category"),
		catalogDir: getArgValue(argv, "--catalog-dir"),
	};
}

function getArgValue(argv: string[], flag: string): string | null {
	const index = argv.indexOf(flag);
	if (index === -1) {
		return null;
	}
	return argv[index + 1] ?? null;
}

function escapeLikePattern(value: string): string {
	return value.replace(/[%_\\]/g, "\\$&");
}

function getCanonicalType(canonicalKey: string): string | null {
	const index = canonicalKey.indexOf("-");
	if (index <= 0) {
		return null;
	}
	return canonicalKey.slice(0, index);
}

function buildProductInsert(definition: ProductDefinition) {
	const attributes = definition.attributes;
	const unit = getStringAttribute(attributes, "volume_unit");
	const quantity = getNumericAttribute(attributes, "volume_value");
	const normalized = normalizeUnitAndQuantity(unit, quantity);

	return {
		name: definition.display_name,
		description: null,
		category: definition.category,
		subcategory: null,
		brand: definition.known_brands[0] ?? null,
		unit: normalized.normalizedUnit ?? unit,
		unitQuantity: quantity != null ? String(quantity) : null,
		imageUrl: null,
		normalizedUnit: normalized.normalizedUnit,
		normalizedQuantity: normalized.normalizedQuantity,
		canonicalKey: definition.canonical_key,
	};
}

function getNumericAttribute(
	attributes: Record<string, unknown>,
	key: string,
): number | null {
	const raw = attributes[key];
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return raw;
	}
	if (typeof raw === "string") {
		const parsed = Number.parseFloat(raw);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function getStringAttribute(
	attributes: Record<string, unknown>,
	key: string,
): string | null {
	const raw = attributes[key];
	if (typeof raw === "string" && raw.trim().length > 0) {
		return raw.trim();
	}
	return null;
}

function normalizeUnitAndQuantity(
	unit: string | null,
	quantity: number | null,
): { normalizedUnit: string | null; normalizedQuantity: number | null } {
	if (!unit || quantity == null || !Number.isFinite(quantity) || quantity <= 0) {
		return { normalizedUnit: null, normalizedQuantity: null };
	}
	const lower = unit.toLowerCase();
	if (lower === "g" || lower === "gr") {
		return { normalizedUnit: "kg", normalizedQuantity: quantity / 1000 };
	}
	if (lower === "ml") {
		return { normalizedUnit: "l", normalizedQuantity: quantity / 1000 };
	}
	if (["lt", "lit", "ltr"].includes(lower)) {
		return { normalizedUnit: "l", normalizedQuantity: quantity };
	}
	if (["komad", "pcs", "ko", "pz"].includes(lower)) {
		return { normalizedUnit: "kom", normalizedQuantity: quantity };
	}
	return { normalizedUnit: lower, normalizedQuantity: quantity };
}

async function insertAliasIfMissing(
	productId: string,
	alias: string,
	source: string,
): Promise<boolean> {
	const db = getDatabase();
	const existing = await db
		.select({ id: productAliases.id })
		.from(productAliases)
		.where(
			and(eq(productAliases.productId, productId), eq(productAliases.alias, alias)),
		)
		.limit(1);
	if (existing.length > 0) {
		return false;
	}
	await db.insert(productAliases).values({ productId, alias, source });
	return true;
}

async function countUnlinkedMatches(
	chainSlug: string,
	namePattern: string,
): Promise<number> {
	const db = getDatabase();
	const result = await db.execute(sql`
		SELECT COUNT(*)::int AS count
		FROM retailer_items ri
		WHERE ri.chain_slug = ${chainSlug}
		AND ri.merged_into_id IS NULL
		AND lower(ri.name) LIKE lower(${`%${escapeLikePattern(namePattern)}%`})
		AND NOT EXISTS (
			SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
		)
	`);
	const rows = (
		Array.isArray(result)
			? result
			: ((result as { rows?: unknown[] }).rows ?? [])
	) as Array<{ count: number }>;
	return Number(rows[0]?.count ?? 0);
}

async function checkAliasExistsByCanonicalKey(
	canonicalKey: string,
	alias: string,
): Promise<boolean> {
	const db = getDatabase();
	const row = await db
		.select({ id: productAliases.id })
		.from(productAliases)
		.innerJoin(products, eq(productAliases.productId, products.id))
		.where(
			and(eq(products.canonicalKey, canonicalKey), eq(productAliases.alias, alias)),
		)
		.limit(1);
	return row.length > 0;
}

async function relationExists(
	productId: string,
	relatedProductId: string,
): Promise<boolean> {
	const db = getDatabase();
	const existing = await db
		.select({ id: productRelations.id })
		.from(productRelations)
		.where(
			and(
				eq(productRelations.productId, productId),
				eq(productRelations.relatedProductId, relatedProductId),
				eq(productRelations.relationType, "variant"),
			),
		)
		.limit(1);
	return existing.length > 0;
}

main().catch((error) => {
	log.error("Knowledge apply failed", { error });
	process.exit(1);
});
