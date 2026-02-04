import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import type { CsvColumnMapping } from "../../parsers/csv";
import { expandZip } from "../../parsers/zip";
import type {
	DiscoveredFile,
	ExpandedFile,
	FetchedFile,
	ParseOptions,
	ParseResult,
} from "../../types";
import { BaseCsvAdapter } from "../base/csv";
import { chainConfigs } from "../config";

const plodineColumnMapping: CsvColumnMapping = {
	externalId: "Sifra proizvoda",
	name: "Naziv proizvoda",
	category: "Kategorija proizvoda",
	brand: "Marka proizvoda",
	unit: "Jedinica mjere",
	unitQuantity: "Neto kolicina",
	price: "Maloprodajna cijena",
	discountPrice: "MPC za vrijeme posebnog oblika prodaje",
	barcodes: "Barkod",
	unitPrice: "Cijena po JM",
	lowestPrice30d: "Najniza cijena u poslj. 30 dana",
	anchorPrice: "Sidrena cijena",
};

const plodineColumnMappingAlt: CsvColumnMapping = {
	externalId: "Šifra",
	name: "Naziv",
	category: "Kategorija",
	brand: "Marka",
	unit: "Mjerna jedinica",
	unitQuantity: "Količina",
	price: "Cijena",
	discountPrice: "Akcijska cijena",
	discountStart: "Početak akcije",
	discountEnd: "Kraj akcije",
	barcodes: "Barkod",
	unitPrice: "Cijena za jedinicu mjere",
	lowestPrice30d: "Najniža cijena u zadnjih 30 dana",
	anchorPrice: "Sidrena cijena",
	unitPriceBaseQuantity: "Količina za jedinicu mjere",
	unitPriceBaseUnit: "Jedinica mjere za cijenu",
	anchorPriceAsOf: "Datum sidrene cijene",
};

export class PlodineAdapter extends BaseCsvAdapter {
	private discoveryDate?: string;
	private static readonly portalUrls = [
		"https://www.plodine.hr/cjenici/3005",
		"https://www.plodine.hr/cjenici",
		"https://www.plodine.hr/info-o-cijenama",
	];

	constructor() {
		const chainConfig = chainConfigs.plodine;
		super({
			baseConfig: {
				slug: chainConfig.id,
				name: chainConfig.name,
				supportedTypes: chainConfig.supportedTypes,
				chainConfig,
				filenamePrefixPatterns: [
					"(?i)^Plodine[_-]?",
					"(?i)^cjenik[_-]?",
					"(?i)^cjenici[_-]?",
				],
				fileExtensionPattern: /\.(csv|CSV|zip|ZIP)$/,
			},
			columnMapping: plodineColumnMapping,
			alternativeColumnMapping: plodineColumnMappingAlt,
		});
	}

	setDiscoveryDate(date: string): void {
		this.discoveryDate = date;
	}

	async discover(targetDate?: string): Promise<DiscoveredFile[]> {
		const discovered: DiscoveredFile[] = [];
		const seen = new Set<string>();

		let date = targetDate || this.discoveryDate;
		if (!date) {
			date = new Date().toISOString().slice(0, 10);
		}

		const parts = date.split("-");
		if (parts.length !== 3) {
			throw new Error(`Invalid date format: ${date} (expected YYYY-MM-DD)`);
		}
		const targetPattern = `${parts[2]}_${parts[1]}_${parts[0]}`;

		const html = await this.fetchPortalHtml();

		const patterns = [
			/href=["']([^"']*cjenik[^"']*\.zip(?:\?[^"']*)?)["']/gi,
			/href=["']([^"']*cjenici[^"']*\.zip(?:\?[^"']*)?)["']/gi,
			/href=["'](https:\/\/[^"']*\/cjenici\/cjeniki_(\d{2}_\d{2}_\d{4})_\d{2}_\d{2}_\d{2}\.zip)["']/gi,
			/href=["'](https:\/\/[^"']*\/cjenici_(\d{2}_\d{2}_\d{4})_\d{2}_\d{2}_\d{2}\.zip)["']/gi,
			/href=["']([^"']*cjenici_(\d{2}_\d{2}_\d{4})_\d{2}_\d{2}_\d{2}\.zip)["']/gi,
		];

		for (const pattern of patterns) {
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(html)) !== null) {
				const rawUrl = match[1];
				const fileDatePattern =
					match[2] ?? extractDatePatternFromText(rawUrl) ?? "";
				if (fileDatePattern && fileDatePattern !== targetPattern) {
					continue;
				}
				const fileUrl = rawUrl.startsWith("http")
					? rawUrl
					: `https://www.plodine.hr${rawUrl}`;
				if (seen.has(fileUrl)) {
					continue;
				}
				seen.add(fileUrl);
				const filename = fileUrl.slice(fileUrl.lastIndexOf("/") + 1);
				discovered.push({
					url: fileUrl,
					filename,
					type: "zip",
					lastModified: new Date(date),
					metadata: {
						source: "plodine_portal",
						discoveredAt: new Date().toISOString(),
						portalDate: date,
						fileDatePattern,
					},
				});
			}
			if (discovered.length > 0) {
				break;
			}
		}

		return discovered;
	}

	private async fetchPortalHtml(): Promise<string> {
		const urlsToTry = new Set<string>([
			this.baseUrl(),
			...PlodineAdapter.portalUrls,
		]);
		let lastError: string | undefined;

		for (const url of urlsToTry) {
			try {
				const response = await this.fetchWithRetry(url);
				if (!response.ok) {
					lastError = `status ${response.status} from ${url}`;
					continue;
				}
				return await response.text();
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error);
				try {
					const fallback = await requestWithRelaxedTls(url);
					if (fallback.status >= 200 && fallback.status < 300) {
						return fallback.body.toString("utf-8");
					}
					lastError = `status ${fallback.status} from ${url}`;
				} catch (fallbackError) {
					lastError =
						fallbackError instanceof Error
							? fallbackError.message
							: String(fallbackError);
				}
			}
		}

		throw new Error(
			`Failed to fetch Plodine portal: ${lastError ?? "unknown"}`,
		);
	}

	async fetch(file: DiscoveredFile): Promise<FetchedFile> {
		try {
			return await super.fetch(file);
		} catch {
			const fallback = await requestWithRelaxedTls(file.url);
			if (fallback.status < 200 || fallback.status >= 300) {
				throw new Error(`Failed to fetch file ${file.url}: ${fallback.status}`);
			}
			const content = fallback.body;
			return {
				discovered: file,
				content,
				hash: createHash("sha256").update(content).digest("hex"),
			};
		}
	}

	async expandZip(content: Buffer, filename: string): Promise<ExpandedFile[]> {
		const expanded = await expandZip(content, filename);
		const processed = expanded.map((file) =>
			file.type === "csv"
				? { ...file, content: this.preprocessCsvContent(file.content) }
				: file,
		);
		return processed.filter((file) => file.type === "csv");
	}

	async parse(
		content: Buffer,
		filename: string,
		options?: ParseOptions,
	): Promise<ParseResult> {
		const preprocessed = this.preprocessCsvContent(content);
		return super.parse(preprocessed, filename, options);
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		const baseName = filename.replace(/\.(csv|CSV)$/i, "");
		const parts = baseName.split("_");
		if (parts.length >= 6) {
			return parts[5];
		}
		return super.extractStoreIdentifierFromFilename(filename);
	}

	private preprocessCsvContent(content: Buffer): Buffer {
		let text = content.toString("utf-8");
		text = text.replace(/Sidrena cijena na \d+\.\d+\.\d+/g, "Sidrena cijena");
		text = text.replace(/;,([0-9])/g, ";0,$1");
		text = text.replace(/^,([0-9])/g, "0,$1");
		text = text.replace(/",([0-9])/g, '"0,$1');
		return Buffer.from(text);
	}
}

function extractDatePatternFromText(text: string): string | undefined {
	const underscore = text.match(/(\d{2})_(\d{2})_(\d{4})/);
	if (underscore) {
		return `${underscore[1]}_${underscore[2]}_${underscore[3]}`;
	}
	const dash = text.match(/(\d{2})-(\d{2})-(\d{4})/);
	if (dash) {
		return `${dash[1]}_${dash[2]}_${dash[3]}`;
	}
	const compact = text.match(/(\d{4})(\d{2})(\d{2})/);
	if (compact) {
		return `${compact[3]}_${compact[2]}_${compact[1]}`;
	}
	return undefined;
}

async function requestWithRelaxedTls(
	url: string,
	redirects = 0,
): Promise<{ status: number; body: Buffer }> {
	if (redirects > 5) {
		throw new Error(`Too many redirects while fetching ${url}`);
	}

	const parsed = new URL(url);
	const client = parsed.protocol === "https:" ? https : (http as typeof http);

	return new Promise((resolve, reject) => {
		const req = client.request(
			parsed,
			{
				method: "GET",
				headers: {
					"User-Agent": "Kosarica-Ingestion/1.0",
					Accept: "*/*",
				},
				rejectUnauthorized: parsed.protocol === "https:" ? false : undefined,
			},
			async (res) => {
				const status = res.statusCode ?? 0;
				const location = res.headers.location;
				if (location && status >= 300 && status < 400) {
					try {
						const redirected = new URL(location, parsed).toString();
						resolve(await requestWithRelaxedTls(redirected, redirects + 1));
					} catch (error) {
						reject(error);
					}
					return;
				}

				const chunks: Buffer[] = [];
				res.on("data", (chunk) => {
					chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
				});
				res.on("end", () => {
					resolve({
						status,
						body: Buffer.concat(chunks),
					});
				});
			},
		);
		req.on("error", reject);
		req.end();
	});
}
