export interface CatalogMeta {
	version: string;
	updated_at: string;
	updated_by: string;
	description: string;
}

export interface BrandCompany {
	id: string;
	name: string;
}

export interface BrandSubBrand {
	id: string;
	name: string;
	aliases: string[];
}

export interface BrandRecord {
	id: string;
	name: string;
	aliases: string[];
	sub_brands?: BrandSubBrand[];
	private_label_for?: string;
}

export interface BrandFile {
	_meta: CatalogMeta;
	company: BrandCompany;
	brands: BrandRecord[];
}

export interface ProductDefinition {
	canonical_key: string;
	display_name: string;
	product_type: string;
	category: string;
	attributes: Record<string, unknown>;
	known_brands: string[];
}

export interface ProductFile {
	_meta: CatalogMeta;
	products: ProductDefinition[];
}

export interface ProductTypeRuleDefinition {
	id: string;
	product_type: string;
	patterns: string[];
	anti_patterns?: string[];
	flags?: string;
}

export type AttributeTransform = "number" | "lowercase" | "boolean" | "raw";

export interface AttributeRuleDefinition {
	id: string;
	attribute: string;
	pattern: string;
	target_group: string;
	transform?: AttributeTransform;
	flags?: string;
}

export interface ExtractionFile {
	_meta: CatalogMeta;
	product_type_rules: ProductTypeRuleDefinition[];
	attribute_rules: AttributeRuleDefinition[];
}

export interface EquivalenceItem {
	chain: string;
	name_pattern: string;
	barcode?: string;
}

export interface EquivalenceDefinition {
	canonical_key: string;
	items: EquivalenceItem[];
}

export interface EquivalenceFile {
	_meta: CatalogMeta;
	equivalences: EquivalenceDefinition[];
}

export interface ChainKnowledgeFile {
	_meta: CatalogMeta;
	chain: string;
	naming_conventions: string[];
	common_abbreviations: Record<string, string>;
	private_label_brands: string[];
}

export interface BrandNode {
	id: string;
	name: string;
	aliases: string[];
	companyId: string;
	companyName: string;
	parentBrandId: string | null;
	privateLabelFor: string | null;
}

export interface CompiledProductTypeRule {
	id: string;
	productType: string;
	patterns: RegExp[];
	antiPatterns: RegExp[];
}

export interface CompiledAttributeRule {
	id: string;
	attribute: string;
	pattern: RegExp;
	targetGroup: string;
	transform: AttributeTransform;
}

export interface CompiledExtractionRuleSet {
	category: string;
	meta: CatalogMeta;
	productTypeRules: CompiledProductTypeRule[];
	attributeRules: CompiledAttributeRule[];
}

export interface CompiledEquivalenceDefinition {
	canonicalKey: string;
	items: EquivalenceItem[];
}

export interface KnowledgeCatalog {
	sourceDir: string;
	loadedAt: Date;
	brandFiles: BrandFile[];
	productFiles: ProductFile[];
	extractionFiles: ExtractionFile[];
	chains: Map<string, ChainKnowledgeFile>;
	brandsById: Map<string, BrandNode>;
	brandAliases: Map<string, string>;
	privateLabelBrandIds: Set<string>;
	productsByCanonicalKey: Map<string, ProductDefinition>;
	productsByType: Map<string, ProductDefinition[]>;
	extractionByCategory: Map<string, CompiledExtractionRuleSet>;
	equivalencesVerified: CompiledEquivalenceDefinition[];
	equivalencesCandidates: CompiledEquivalenceDefinition[];
	equivalencesByCanonicalKey: Map<string, CompiledEquivalenceDefinition[]>;
}

export interface ResolvedBrand {
	brandId: string;
	parentBrand: string;
	company: string;
	isPrivateLabel: boolean;
	chain?: string;
}

export interface ExtractedAttributes {
	productType: string | null;
	canonicalKey: string | null;
	attributes: {
		fatPercent?: number;
		volumeValue?: number;
		volumeUnit?: string;
		packaging?: string;
		grade?: string;
		organic?: boolean;
		count?: number;
		multipackCount?: number;
		sparkling?: string;
	};
	resolvedBrand: ResolvedBrand | null;
}
