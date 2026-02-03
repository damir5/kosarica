import { type XmlFieldMapping, XmlParser } from "../../parsers/xml";
import type {
	DiscoveredFile,
	ParseOptions,
	ParseResult,
	StoreIdentifier,
} from "../../types";
import { type BaseAdapterConfig, BaseChainAdapter } from "./chain";

export interface XmlAdapterConfig {
	baseConfig: BaseAdapterConfig;
	fieldMapping: XmlFieldMapping;
	alternativeFieldMapping?: XmlFieldMapping;
	defaultItemsPath?: string;
	itemPaths?: string[];
}

export class BaseXmlAdapter extends BaseChainAdapter {
	protected fieldMapping: XmlFieldMapping;
	protected altMapping?: XmlFieldMapping;
	protected itemPaths: string[];

	constructor(cfg: XmlAdapterConfig) {
		super({
			...cfg.baseConfig,
			fileExtensionPattern:
				cfg.baseConfig.fileExtensionPattern ?? /\.(xml|XML)$/,
		});

		this.fieldMapping = cfg.fieldMapping;
		this.altMapping = cfg.alternativeFieldMapping;
		this.itemPaths = cfg.itemPaths ?? [
			"products.product",
			"Products.Product",
			"items.item",
			"Items.Item",
			"data.product",
			"Data.Product",
			"Cjenik.Proizvod",
			"cjenik.proizvod",
		];

		if (
			cfg.defaultItemsPath &&
			!this.itemPaths.includes(cfg.defaultItemsPath)
		) {
			this.itemPaths.unshift(cfg.defaultItemsPath);
		}
	}

	async parse(
		content: Buffer,
		filename: string,
		_options?: ParseOptions,
	): Promise<ParseResult> {
		const storeIdentifier = this.extractStoreIdentifierFromFilename(filename);
		let lastResult: ParseResult | null = null;

		for (const itemsPath of this.itemPaths) {
			const parser = new XmlParser({
				itemsPath,
				fieldMapping: this.fieldMapping,
				defaultStoreIdentifier: storeIdentifier,
				attributePrefix: "@_",
				encoding: "auto",
			});
			const result = parser.parseWithItemsPath(
				content,
				itemsPath,
				this.fieldMapping,
				storeIdentifier,
			);
			lastResult = result;
			if (result.validRows > 0) {
				return result;
			}
		}

		if (this.altMapping) {
			for (const itemsPath of this.itemPaths) {
				const parser = new XmlParser({
					itemsPath,
					fieldMapping: this.altMapping,
					defaultStoreIdentifier: storeIdentifier,
					attributePrefix: "@_",
					encoding: "auto",
				});
				const result = parser.parseWithItemsPath(
					content,
					itemsPath,
					this.altMapping,
					storeIdentifier,
				);
				lastResult = result;
				if (result.validRows > 0) {
					return result;
				}
			}
		}

		return (
			lastResult ?? {
				rows: [],
				errors: [],
				warnings: [],
				totalRows: 0,
				validRows: 0,
			}
		);
	}

	extractStoreIdentifier(file: DiscoveredFile): StoreIdentifier | null {
		const storeId = file.metadata?.storeId;
		if (storeId) {
			return { type: "portal_id", value: storeId };
		}
		const fallback = this.extractStoreIdentifierFromFilename(file.filename);
		if (fallback) {
			return { type: "filename_code", value: fallback };
		}
		return null;
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		const baseName = filename.replace(this.fileExtensionPattern, "");
		let cleanName = baseName;
		for (const pattern of this.filenamePrefixPatterns) {
			cleanName = cleanName.replace(pattern, "");
		}
		cleanName = cleanName.trim();

		const patterns = [
			/(?:store|poslovnica|trgovina)[_-]?(\d+)/i,
			/(?:store|poslovnica|trgovina)[_-]?([A-Za-z0-9]+)/i,
		];
		for (const pattern of patterns) {
			const match = cleanName.match(pattern);
			if (match?.[1]) {
				return match[1];
			}
		}

		if (!cleanName) {
			return filename.replace(this.fileExtensionPattern, "");
		}
		return cleanName;
	}
}
