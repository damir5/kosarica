import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import YAML from "yaml";
import type {
	BrandFile,
	BrandNode,
	ChainKnowledgeFile,
	CompiledAttributeRule,
	CompiledEquivalenceDefinition,
	CompiledExtractionRuleSet,
	CompiledProductTypeRule,
	EquivalenceFile,
	ExtractionFile,
	KnowledgeCatalog,
	ProductDefinition,
	ProductFile,
} from "./types";
import { normalizeKnowledgeText } from "./utils";

const DEFAULT_CATALOG_DIR = resolve(process.cwd(), "knowledge");

let cachedCatalog: KnowledgeCatalog | null = null;
let cachedDir: string | null = null;

export function getCachedCatalog(): KnowledgeCatalog | null {
	return cachedCatalog;
}

export async function loadCatalog(dir?: string): Promise<KnowledgeCatalog> {
	const sourceDir = resolve(dir ?? DEFAULT_CATALOG_DIR);
	if (cachedCatalog && cachedDir === sourceDir) {
		return cachedCatalog;
	}

	const catalog = await buildCatalog(sourceDir);
	cachedCatalog = catalog;
	cachedDir = sourceDir;
	return catalog;
}

export async function reloadCatalog(dir?: string): Promise<KnowledgeCatalog> {
	cachedCatalog = null;
	cachedDir = null;
	return loadCatalog(dir);
}

async function buildCatalog(sourceDir: string): Promise<KnowledgeCatalog> {
	const brandsDir = join(sourceDir, "brands");
	const productsDir = join(sourceDir, "products");
	const extractionDir = join(sourceDir, "extraction");
	const equivalencesDir = join(sourceDir, "equivalences");
	const chainsDir = join(sourceDir, "chains");

	const brandPaths = (await listYamlFiles(brandsDir)).filter(
		(file) => basename(file) !== "_index.yaml",
	);
	const productPaths = (await listYamlFiles(productsDir)).filter(
		(file) => !basename(file).startsWith("_"),
	);
	const extractionPaths = await listYamlFiles(extractionDir);
	const chainPaths = await listYamlFiles(chainsDir);

	const brandFiles: BrandFile[] = [];
	const brandsById = new Map<string, BrandNode>();
	const brandAliases = new Map<string, string>();
	const privateLabelBrandIds = new Set<string>();

	for (const filePath of brandPaths) {
		const file = await parseYamlFile<BrandFile>(filePath);
		brandFiles.push(file);

		for (const brand of file.brands) {
			const node: BrandNode = {
				id: brand.id,
				name: brand.name,
				aliases: [brand.name, ...brand.aliases],
				companyId: file.company.id,
				companyName: file.company.name,
				parentBrandId: null,
				privateLabelFor: brand.private_label_for ?? null,
			};

			if (brand.private_label_for) {
				privateLabelBrandIds.add(brand.id);
			}

			addBrandNode(brandsById, node);
			addBrandAliases(brandAliases, brand.id, [brand.name, ...brand.aliases]);

			for (const subBrand of brand.sub_brands ?? []) {
				const subNode: BrandNode = {
					id: subBrand.id,
					name: subBrand.name,
					aliases: [subBrand.name, ...subBrand.aliases],
					companyId: file.company.id,
					companyName: file.company.name,
					parentBrandId: brand.id,
					privateLabelFor: brand.private_label_for ?? null,
				};

				if (brand.private_label_for) {
					privateLabelBrandIds.add(subBrand.id);
				}

				addBrandNode(brandsById, subNode);
				addBrandAliases(brandAliases, subBrand.id, [
					subBrand.name,
					...subBrand.aliases,
				]);
			}
		}
	}

	const productFiles: ProductFile[] = [];
	const productsByCanonicalKey = new Map<string, ProductDefinition>();
	const productsByType = new Map<string, ProductDefinition[]>();

	for (const filePath of productPaths) {
		const file = await parseYamlFile<ProductFile>(filePath);
		productFiles.push(file);

		for (const product of file.products) {
			const existing = productsByCanonicalKey.get(product.canonical_key);
			if (existing) {
				throw new Error(
					`Duplicate canonical key '${product.canonical_key}' in products catalog`,
				);
			}
			productsByCanonicalKey.set(product.canonical_key, product);

			const byType = productsByType.get(product.product_type) ?? [];
			byType.push(product);
			productsByType.set(product.product_type, byType);
		}
	}

	const extractionFiles: ExtractionFile[] = [];
	const extractionByCategory = new Map<string, CompiledExtractionRuleSet>();

	for (const filePath of extractionPaths) {
		const file = await parseYamlFile<ExtractionFile>(filePath);
		extractionFiles.push(file);
		const category = basename(filePath, extname(filePath));

		const productTypeRules: CompiledProductTypeRule[] =
			file.product_type_rules.map((rule) => ({
				id: rule.id,
				productType: rule.product_type,
				patterns: rule.patterns.map((pattern) =>
					compileRegex(pattern, rule.flags, `${category}:${rule.id}:pattern`),
				),
				antiPatterns: (rule.anti_patterns ?? []).map((pattern) =>
					compileRegex(pattern, rule.flags, `${category}:${rule.id}:anti-pattern`),
				),
			}));

		const attributeRules: CompiledAttributeRule[] = file.attribute_rules.map(
			(rule) => ({
				id: rule.id,
				attribute: rule.attribute,
				pattern: compileRegex(
					rule.pattern,
					rule.flags,
					`${category}:${rule.id}:attribute`,
				),
				targetGroup: rule.target_group,
				transform: rule.transform ?? "raw",
			}),
		);

		extractionByCategory.set(category, {
			category,
			meta: file._meta,
			productTypeRules,
			attributeRules,
		});
	}

	const chains = new Map<string, ChainKnowledgeFile>();
	for (const filePath of chainPaths) {
		const file = await parseYamlFile<ChainKnowledgeFile>(filePath);
		chains.set(file.chain, file);
	}

	const verifiedEquivalences = await loadEquivalences(
		join(equivalencesDir, "_verified.yaml"),
	);
	const candidateEquivalences = await loadEquivalences(
		join(equivalencesDir, "_candidates.yaml"),
	);

	const equivalencesByCanonicalKey = new Map<
		string,
		CompiledEquivalenceDefinition[]
	>();
	for (const equivalence of [...verifiedEquivalences, ...candidateEquivalences]) {
		const bucket =
			equivalencesByCanonicalKey.get(equivalence.canonicalKey) ?? [];
		bucket.push(equivalence);
		equivalencesByCanonicalKey.set(equivalence.canonicalKey, bucket);
	}

	return {
		sourceDir,
		loadedAt: new Date(),
		brandFiles,
		productFiles,
		extractionFiles,
		chains,
		brandsById,
		brandAliases,
		privateLabelBrandIds,
		productsByCanonicalKey,
		productsByType,
		extractionByCategory,
		equivalencesVerified: verifiedEquivalences,
		equivalencesCandidates: candidateEquivalences,
		equivalencesByCanonicalKey,
	};
}

function addBrandNode(brandsById: Map<string, BrandNode>, node: BrandNode): void {
	const existing = brandsById.get(node.id);
	if (existing) {
		throw new Error(`Duplicate brand id '${node.id}' in knowledge catalog`);
	}
	brandsById.set(node.id, node);
}

function addBrandAliases(
	brandAliases: Map<string, string>,
	brandId: string,
	aliases: string[],
): void {
	for (const alias of aliases) {
		const normalizedAlias = normalizeKnowledgeText(alias);
		if (!normalizedAlias) {
			continue;
		}
		const existingBrandId = brandAliases.get(normalizedAlias);
		if (existingBrandId && existingBrandId !== brandId) {
			throw new Error(
				`Brand alias collision for '${alias}': ${existingBrandId} vs ${brandId}`,
			);
		}
		brandAliases.set(normalizedAlias, brandId);
	}
}

function compileRegex(pattern: string, flags: string | undefined, context: string): RegExp {
	try {
		return new RegExp(pattern, flags ?? "iu");
	} catch (error) {
		throw new Error(
			`Invalid regex in ${context}: ${pattern}. ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function loadEquivalences(
	filePath: string,
): Promise<CompiledEquivalenceDefinition[]> {
	const file = await parseYamlFile<EquivalenceFile>(filePath);
	return file.equivalences.map((equivalence) => ({
		canonicalKey: equivalence.canonical_key,
		items: equivalence.items,
	}));
}

async function parseYamlFile<T>(filePath: string): Promise<T> {
	const content = await readFile(filePath, "utf8");
	const parsed = YAML.parse(content) as unknown;
	if (!parsed || typeof parsed !== "object") {
		throw new Error(`YAML file ${filePath} must parse to an object`);
	}
	return parsed as T;
}

async function listYamlFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const absolutePath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listYamlFiles(absolutePath)));
			continue;
		}
		if (entry.isFile() && [".yaml", ".yml"].includes(extname(entry.name))) {
			files.push(absolutePath);
		}
	}

	files.sort();
	return files;
}
