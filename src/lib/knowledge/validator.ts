import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import type { ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import YAML from "yaml";
import type {
	BrandFile,
	ChainKnowledgeFile,
	EquivalenceFile,
	ExtractionFile,
	ProductFile,
} from "./types";

const DEFAULT_CATALOG_DIR = resolve(process.cwd(), "knowledge");

export interface ValidationError {
	file: string;
	message: string;
	path?: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
}

export async function validateCatalog(dir?: string): Promise<ValidationResult> {
	const catalogDir = resolve(dir ?? DEFAULT_CATALOG_DIR);
	const errors: ValidationError[] = [];
	const schemaValidators = await loadSchemaValidators(catalogDir, errors);
	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const brandFiles = (await listYamlFiles(join(catalogDir, "brands"))).filter(
		(filePath) => basename(filePath) !== "_index.yaml",
	);
	const productFiles = (await listYamlFiles(join(catalogDir, "products"))).filter(
		(filePath) => !basename(filePath).startsWith("_"),
	);
	const extractionFiles = await listYamlFiles(join(catalogDir, "extraction"));
	const equivalenceFiles = await listYamlFiles(join(catalogDir, "equivalences"));
	const chainFiles = await listYamlFiles(join(catalogDir, "chains"));
	const opsFiles = await listYamlFiles(join(catalogDir, "ops"));
	const storeKnowledgeFiles = await listYamlFiles(join(catalogDir, "stores"));

	const parsedBrandFiles: BrandFile[] = [];
	const parsedProductFiles: ProductFile[] = [];
	const parsedExtractionFiles: ExtractionFile[] = [];
	const parsedEquivalenceFiles: EquivalenceFile[] = [];
	const parsedChainFiles: ChainKnowledgeFile[] = [];

	for (const filePath of brandFiles) {
		const parsed = await parseYaml(filePath, catalogDir, errors);
		if (!parsed) continue;
		validateWithSchema(
			schemaValidators.brand,
			parsed,
			filePath,
			catalogDir,
			errors,
		);
		if (isObject(parsed)) {
			parsedBrandFiles.push(parsed as unknown as BrandFile);
		}
	}

	for (const filePath of productFiles) {
		const parsed = await parseYaml(filePath, catalogDir, errors);
		if (!parsed) continue;
		validateWithSchema(
			schemaValidators.product,
			parsed,
			filePath,
			catalogDir,
			errors,
		);
		if (isObject(parsed)) {
			parsedProductFiles.push(parsed as unknown as ProductFile);
		}
	}

	for (const filePath of extractionFiles) {
		const parsed = await parseYaml(filePath, catalogDir, errors);
		if (!parsed) continue;
		validateWithSchema(
			schemaValidators.extraction,
			parsed,
			filePath,
			catalogDir,
			errors,
		);
		if (isObject(parsed)) {
			const extractionFile = parsed as unknown as ExtractionFile;
			parsedExtractionFiles.push(extractionFile);
			validateExtractionRegexes(extractionFile, filePath, catalogDir, errors);
		}
	}

	for (const filePath of equivalenceFiles) {
		const parsed = await parseYaml(filePath, catalogDir, errors);
		if (!parsed) continue;
		validateWithSchema(
			schemaValidators.equivalence,
			parsed,
			filePath,
			catalogDir,
			errors,
		);
		if (isObject(parsed)) {
			parsedEquivalenceFiles.push(parsed as unknown as EquivalenceFile);
		}
	}

	for (const filePath of chainFiles) {
		const parsed = await parseYaml(filePath, catalogDir, errors);
		if (!parsed) continue;
		validateWithSchema(
			schemaValidators.chain,
			parsed,
			filePath,
			catalogDir,
			errors,
		);
		if (isObject(parsed)) {
			const chainFile = parsed as unknown as ChainKnowledgeFile;
			parsedChainFiles.push(chainFile);
			const expectedChain = basename(filePath, extname(filePath));
			if (chainFile.chain !== expectedChain) {
				errors.push({
					file: relative(catalogDir, filePath),
					message: `Chain slug '${chainFile.chain}' must match filename '${expectedChain}'`,
				});
			}
		}
	}

	for (const filePath of storeKnowledgeFiles) {
		const parsed = await parseYaml(filePath, catalogDir, errors);
		if (!parsed) continue;
		const filename = basename(filePath);
		if (filename === "geocode-cache.yaml") {
			validateWithSchema(
				schemaValidators.storeGeocode,
				parsed,
				filePath,
				catalogDir,
				errors,
			);
			continue;
		}
		if (filename === "aliases.yaml") {
			validateWithSchema(
				schemaValidators.storeAliases,
				parsed,
				filePath,
				catalogDir,
				errors,
			);
			continue;
		}
		if (filename === "changelog.yaml") {
			validateWithSchema(
				schemaValidators.storeChangelog,
				parsed,
				filePath,
				catalogDir,
				errors,
			);
			continue;
		}

		errors.push({
			file: relative(catalogDir, filePath),
			message:
				"Unknown store knowledge file. Expected geocode-cache.yaml, aliases.yaml, or changelog.yaml",
		});
	}

	for (const filePath of opsFiles) {
		const parsed = await parseYaml(filePath, catalogDir, errors);
		if (!parsed) continue;
		const filename = basename(filePath);
		if (filename === "loop-state.yaml") {
			validateWithSchema(
				schemaValidators.loopState,
				parsed,
				filePath,
				catalogDir,
				errors,
			);
			continue;
		}
		if (filename === "kpi-thresholds.yaml") {
			validateWithSchema(
				schemaValidators.kpiThresholds,
				parsed,
				filePath,
				catalogDir,
				errors,
			);
			continue;
		}
		if (filename === "alerts-history.yaml") {
			validateWithSchema(
				schemaValidators.alertsHistory,
				parsed,
				filePath,
				catalogDir,
				errors,
			);
			continue;
		}
		if (filename === "dashboard-latest.yaml") {
			validateWithSchema(
				schemaValidators.dashboardLatest,
				parsed,
				filePath,
				catalogDir,
				errors,
			);
			continue;
		}

		errors.push({
			file: relative(catalogDir, filePath),
			message:
				"Unknown ops file. Expected loop-state.yaml, kpi-thresholds.yaml, alerts-history.yaml, or dashboard-latest.yaml",
		});
	}

	validateCrossReferences(
		parsedBrandFiles,
		parsedProductFiles,
		parsedEquivalenceFiles,
		parsedChainFiles,
		errors,
		catalogDir,
	);

	return {
		valid: errors.length === 0,
		errors,
	};
}

function validateCrossReferences(
	brandFiles: BrandFile[],
	productFiles: ProductFile[],
	equivalenceFiles: EquivalenceFile[],
	chainFiles: ChainKnowledgeFile[],
	errors: ValidationError[],
	catalogDir: string,
): void {
	const knownBrands = new Set<string>();
	for (const file of brandFiles) {
		for (const brand of file.brands) {
			knownBrands.add(brand.id);
			for (const subBrand of brand.sub_brands ?? []) {
				knownBrands.add(subBrand.id);
			}
		}
	}

	const knownCanonicalKeys = new Set<string>();
	for (const file of productFiles) {
		for (const product of file.products) {
			knownCanonicalKeys.add(product.canonical_key);
			for (const brandId of product.known_brands) {
				if (!knownBrands.has(brandId)) {
					errors.push({
						file: relative(catalogDir, "products"),
						message: `Unknown brand id '${brandId}' referenced by product '${product.canonical_key}'`,
					});
				}
			}
		}
	}

	const knownChains = new Set(chainFiles.map((file) => file.chain));
	for (const file of equivalenceFiles) {
		for (const equivalence of file.equivalences) {
			if (!knownCanonicalKeys.has(equivalence.canonical_key)) {
				errors.push({
					file: relative(catalogDir, "equivalences"),
					message: `Unknown canonical key '${equivalence.canonical_key}' in equivalences`,
				});
			}
			for (const item of equivalence.items) {
				if (!knownChains.has(item.chain)) {
					errors.push({
						file: relative(catalogDir, "equivalences"),
						message: `Unknown chain slug '${item.chain}' in equivalence '${equivalence.canonical_key}'`,
					});
				}
			}
		}
	}
}

function validateExtractionRegexes(
	file: ExtractionFile,
	filePath: string,
	catalogDir: string,
	errors: ValidationError[],
): void {
	for (const rule of file.product_type_rules) {
		for (const pattern of rule.patterns) {
			tryCompileRegex(pattern, rule.flags, filePath, catalogDir, errors);
		}
		for (const pattern of rule.anti_patterns ?? []) {
			tryCompileRegex(pattern, rule.flags, filePath, catalogDir, errors);
		}
	}

	for (const rule of file.attribute_rules) {
		tryCompileRegex(rule.pattern, rule.flags, filePath, catalogDir, errors);
	}
}

function tryCompileRegex(
	pattern: string,
	flags: string | undefined,
	filePath: string,
	catalogDir: string,
	errors: ValidationError[],
): void {
	try {
		new RegExp(pattern, flags ?? "iu");
	} catch (error) {
		errors.push({
			file: relative(catalogDir, filePath),
			message: `Invalid regex '${pattern}': ${
				error instanceof Error ? error.message : String(error)
			}`,
		});
	}
}

async function parseYaml(
	filePath: string,
	catalogDir: string,
	errors: ValidationError[],
): Promise<unknown | null> {
	try {
		const content = await readFile(filePath, "utf8");
		return YAML.parse(content) as unknown;
	} catch (error) {
		errors.push({
			file: relative(catalogDir, filePath),
			message: `Failed to parse YAML: ${
				error instanceof Error ? error.message : String(error)
			}`,
		});
		return null;
	}
}

function validateWithSchema(
	validator: ValidateFunction,
	payload: unknown,
	filePath: string,
	catalogDir: string,
	errors: ValidationError[],
): void {
	if (validator(payload)) {
		return;
	}

	for (const issue of validator.errors ?? []) {
		errors.push({
			file: relative(catalogDir, filePath),
			message: `${issue.message ?? "Schema validation error"}`,
			path: issue.instancePath,
		});
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

async function loadSchemaValidators(
	catalogDir: string,
	errors: ValidationError[],
): Promise<
	Record<
		| "brand"
		| "product"
		| "extraction"
		| "equivalence"
		| "chain"
		| "storeGeocode"
		| "storeAliases"
		| "storeChangelog"
		| "loopState"
		| "kpiThresholds"
		| "alertsHistory"
		| "dashboardLatest",
		ValidateFunction
	>
> {
	const schemaDir = join(catalogDir, "_schema");
	const ajv = new Ajv2020({
		allErrors: true,
		strict: false,
		validateFormats: false,
	});

	const schemas: Record<
		| "brand"
		| "product"
		| "extraction"
		| "equivalence"
		| "chain"
		| "storeGeocode"
		| "storeAliases"
		| "storeChangelog"
		| "loopState"
		| "kpiThresholds"
		| "alertsHistory"
		| "dashboardLatest",
		object
	> = {
		brand: await readSchema(join(schemaDir, "brand.schema.json"), errors),
		product: await readSchema(join(schemaDir, "product.schema.json"), errors),
		extraction: await readSchema(
			join(schemaDir, "extraction.schema.json"),
			errors,
		),
		equivalence: await readSchema(
			join(schemaDir, "equivalence.schema.json"),
			errors,
		),
		chain: await readSchema(join(schemaDir, "chain.schema.json"), errors),
		storeGeocode: await readSchema(
			join(schemaDir, "store-geocode.schema.json"),
			errors,
		),
		storeAliases: await readSchema(
			join(schemaDir, "store-aliases.schema.json"),
			errors,
		),
		storeChangelog: await readSchema(
			join(schemaDir, "store-changelog.schema.json"),
			errors,
		),
		loopState: await readSchema(join(schemaDir, "loop-state.schema.json"), errors),
		kpiThresholds: await readSchema(
			join(schemaDir, "kpi-thresholds.schema.json"),
			errors,
		),
		alertsHistory: await readSchema(
			join(schemaDir, "alerts-history.schema.json"),
			errors,
		),
		dashboardLatest: await readSchema(
			join(schemaDir, "dashboard-latest.schema.json"),
			errors,
		),
	};

	return {
		brand: ajv.compile(schemas.brand),
		product: ajv.compile(schemas.product),
		extraction: ajv.compile(schemas.extraction),
		equivalence: ajv.compile(schemas.equivalence),
		chain: ajv.compile(schemas.chain),
		storeGeocode: ajv.compile(schemas.storeGeocode),
		storeAliases: ajv.compile(schemas.storeAliases),
		storeChangelog: ajv.compile(schemas.storeChangelog),
		loopState: ajv.compile(schemas.loopState),
		kpiThresholds: ajv.compile(schemas.kpiThresholds),
		alertsHistory: ajv.compile(schemas.alertsHistory),
		dashboardLatest: ajv.compile(schemas.dashboardLatest),
	};
}

async function readSchema(filePath: string, errors: ValidationError[]): Promise<object> {
	try {
		const content = await readFile(filePath, "utf8");
		return JSON.parse(content) as object;
	} catch (error) {
		errors.push({
			file: filePath,
			message: `Failed to load schema: ${
				error instanceof Error ? error.message : String(error)
			}`,
		});
		return {};
	}
}

async function listYamlFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const filePath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listYamlFiles(filePath)));
			continue;
		}
		if (entry.isFile() && [".yaml", ".yml"].includes(extname(entry.name))) {
			files.push(filePath);
		}
	}

	files.sort();
	return files;
}
