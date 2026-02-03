import { parsePrice } from "../../parsers/price";
import type { XmlFieldMapping } from "../../parsers/xml";
import type { DiscoveredFile, ParseOptions, ParseResult } from "../../types";
import { BaseXmlAdapter } from "../base/xml";
import { chainConfigs } from "../config";

const trgocentarFieldMapping: XmlFieldMapping = {
	externalId: "sif_art",
	name: "naziv_art",
	category: "naz_kat",
	brand: "marka",
	unit: "jmj",
	unitQuantity: "net_kol",
	barcodes: "ean_kod",
	unitPrice: "c_jmj",
	lowestPrice30d: "c_najniza_30",
	price: "mpc",
	discountPrice: "mpc_pop",
	priceExtractor: (item) => {
		const regular = valueFromRecord(item, "mpc");
		if (regular) {
			return regular;
		}
		return valueFromRecord(item, "mpc_pop");
	},
};

export class TrgocentarAdapter extends BaseXmlAdapter {
	private discoveryDate?: string;

	constructor() {
		const chainConfig = chainConfigs.trgocentar;
		super({
			baseConfig: {
				slug: chainConfig.id,
				name: chainConfig.name,
				supportedTypes: chainConfig.supportedTypes,
				chainConfig,
				filenamePrefixPatterns: [
					"(?i)^Trgocentar[_-]?",
					"(?i)^cjenik[_-]?",
					"(?i)^SUPERMARKET[_-]?",
				],
				fileExtensionPattern: /\.(xml|XML)$/,
			},
			fieldMapping: trgocentarFieldMapping,
			defaultItemsPath: "DocumentElement.cjenik",
			itemPaths: ["DocumentElement.cjenik"],
		});
	}

	setDiscoveryDate(date: string): void {
		this.discoveryDate = date;
	}

	async discover(targetDate?: string): Promise<DiscoveredFile[]> {
		const discovered: DiscoveredFile[] = [];
		const seen = new Set<string>();
		let filterDate = targetDate || this.discoveryDate;
		if (!filterDate) {
			filterDate = new Date().toISOString().slice(0, 10);
		}

		const response = await this.fetchWithRetry(this.baseUrl());
		if (!response.ok) {
			throw new Error(
				`Failed to fetch Trgocentar portal: status ${response.status}`,
			);
		}
		const html = await response.text();
		const xmlPattern = /href=["']([^"']*\.xml(?:\?[^"']*)?)["']/gi;
		let match: RegExpExecArray | null;
		while ((match = xmlPattern.exec(html)) !== null) {
			const href = match[1];
			const fileUrl = href.startsWith("http")
				? href
				: `${this.baseUrl()}/${href.replace(/^\//, "")}`;
			if (seen.has(fileUrl)) {
				continue;
			}
			seen.add(fileUrl);
			const filename = this.extractFilenameFromUrl(fileUrl);
			const fileDate = this.extractDateFromFilename(filename);
			if (filterDate && fileDate && fileDate !== filterDate) {
				continue;
			}
			const lastModified = fileDate ? new Date(fileDate) : undefined;
			discovered.push({
				url: fileUrl,
				filename,
				type: "xml",
				lastModified,
				metadata: {
					source: "trgocentar_portal",
					discoveredAt: new Date().toISOString(),
					portalDate: fileDate,
				},
			});
		}

		return discovered;
	}

	async parse(
		content: Buffer,
		filename: string,
		options?: ParseOptions,
	): Promise<ParseResult> {
		const result = await super.parse(content, filename, options);
		for (const row of result.rows) {
			const anchorPrice = this.extractDynamicAnchorPrice(row.rawData);
			if (anchorPrice !== undefined) {
				row.anchorPrice = anchorPrice;
			}
		}
		return result;
	}

	private extractDynamicAnchorPrice(rawData: string): number | undefined {
		try {
			const data = JSON.parse(rawData) as Record<string, unknown>;
			for (const [key, value] of Object.entries(data)) {
				if (/^c_\d{6}$/.test(key)) {
					const stringValue = typeof value === "string" ? value.trim() : "";
					if (!stringValue) {
						continue;
					}
					try {
						return parsePrice(stringValue);
					} catch {
						return undefined;
					}
				}
			}
		} catch {
			return undefined;
		}
		return undefined;
	}

	protected extractFilenameFromUrl(fileUrl: string): string {
		try {
			const parsed = new URL(fileUrl);
			const parts = parsed.pathname.split("/");
			return parts[parts.length - 1] ?? fileUrl;
		} catch {
			return fileUrl;
		}
	}

	private extractDateFromFilename(filename: string): string {
		const match = filename.match(/(\d{2})(\d{2})(\d{4})\d{4}\.xml$/);
		if (match) {
			return `${match[3]}-${match[2]}-${match[1]}`;
		}
		const isoMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
		if (isoMatch) {
			return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
		}
		const euMatch = filename.match(/(\d{2})-(\d{2})-(\d{4})/);
		if (euMatch) {
			return `${euMatch[3]}-${euMatch[2]}-${euMatch[1]}`;
		}
		return "";
	}
}

function valueFromRecord(record: Record<string, unknown>, key: string): string {
	const raw = record[key];
	if (typeof raw === "string") {
		return raw.trim();
	}
	if (typeof raw === "number") {
		return String(raw);
	}
	return "";
}
