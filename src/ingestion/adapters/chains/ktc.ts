import type { Result } from "neverthrow";
import { err, ok, ResultAsync } from "neverthrow";
import { type FetchError, fetchError } from "@/lib/errors";
import type { IngestionClassified } from "../../errors";
import type { CsvColumnMapping } from "../../parsers/csv";
import type { DiscoveredFile, ParseResult } from "../../types";
import { BaseCsvAdapter } from "../base/csv";
import { chainConfigs } from "../config";

const ktcColumnMapping: CsvColumnMapping = {
	externalId: "Šifra proizvoda",
	name: "Naziv proizvoda",
	category: "Kategorija",
	brand: "Marka proizvoda",
	unit: "Jedinica mjere",
	unitQuantity: "Neto količina",
	price: "Maloprodajna cijena",
	discountPrice: "MPC za vrijeme posebnog oblika prodaje",
	barcodes: "Barkod",
	unitPrice: "Cijena za jedinicu mjere",
	lowestPrice30d: "Najniža cijena u posljednjih 30 dana",
};

const ktcColumnMappingAlt: CsvColumnMapping = {
	externalId: "Sifra proizvoda",
	name: "Naziv proizvoda",
	category: "Kategorija",
	brand: "Marka proizvoda",
	unit: "Jedinica mjere",
	unitQuantity: "Neto kolicina",
	price: "Maloprodajna cijena",
	discountPrice: "MPC za vrijeme posebnog oblika prodaje",
	barcodes: "Barkod",
	unitPrice: "Cijena za jedinicu mjere",
	lowestPrice30d: "Najniza cijena u posljednjih 30 dana",
};

export class KtcAdapter extends BaseCsvAdapter {
	private discoveryDate?: string;
	private static readonly portalUrls = [
		"http://www.ktc.hr/cjenici/3005",
		"http://www.ktc.hr/cjenici",
	];

	constructor() {
		const chainConfig = chainConfigs.ktc;
		super({
			baseConfig: {
				slug: chainConfig.id,
				name: chainConfig.name,
				supportedTypes: chainConfig.supportedTypes,
				chainConfig,
				filenamePrefixPatterns: [
					"(?i)^TRGOVINA[_-]?",
					"(?i)^KTC[_-]?",
					"(?i)^cjenik[_-]?",
				],
			},
			columnMapping: ktcColumnMapping,
			alternativeColumnMapping: ktcColumnMappingAlt,
		});
	}

	setDiscoveryDate(date: string): void {
		this.discoveryDate = date;
	}

	discover(
		targetDate?: string,
	): ResultAsync<DiscoveredFile[], FetchError | IngestionClassified> {
		return new ResultAsync(this.discoverImpl(targetDate));
	}

	private async discoverImpl(
		targetDate?: string,
	): Promise<Result<DiscoveredFile[], FetchError | IngestionClassified>> {
		const discovered: DiscoveredFile[] = [];
		const seenUrls = new Set<string>();
		let filterDate = targetDate || this.discoveryDate;
		if (!filterDate) {
			filterDate = new Date().toISOString().slice(0, 10);
		}

		const portalUrlResult = await this.resolvePortalUrl();
		if (portalUrlResult.isErr()) {
			return err(portalUrlResult.error);
		}
		const portalUrl = portalUrlResult.value;

		const responseResult = await this.fetchWithRetry(portalUrl);
		if (responseResult.isErr()) {
			return err(responseResult.error);
		}
		const response = responseResult.value;
		let html = "";
		try {
			html = await response.text();
		} catch (error) {
			return err(
				fetchError({
					url: portalUrl,
					message:
						error instanceof Error ? error.message : "Failed to read response",
					retryable: false,
					attempts: 1,
					cause: error,
				}),
			);
		}

		const storePattern = /poslovnica=([^"&]+)/g;
		const stores: string[] = [];
		const seenStores = new Set<string>();
		let storeMatch: RegExpExecArray | null;
		while ((storeMatch = storePattern.exec(html)) !== null) {
			const storeName = safeDecodeURIComponent(storeMatch[1]);
			if (!seenStores.has(storeName)) {
				seenStores.add(storeName);
				stores.push(storeName);
			}
		}

		for (const storeName of stores) {
			const storeUrl = `${portalUrl}?poslovnica=${encodeURIComponent(storeName)}`;
			const storeResponseResult = await this.fetchWithRetry(storeUrl);
			if (storeResponseResult.isErr()) {
				if (storeResponseResult.error.status) {
					continue;
				}
				return err(storeResponseResult.error);
			}
			const storeResponse = storeResponseResult.value;
			let storeHtml = "";
			try {
				storeHtml = await storeResponse.text();
			} catch (error) {
				return err(
					fetchError({
						url: storeUrl,
						message:
							error instanceof Error
								? error.message
								: "Failed to read response",
						retryable: false,
						attempts: 1,
						cause: error,
					}),
				);
			}
			const csvPattern = /href="([^"]*\.csv)"/gi;
			let csvMatch: RegExpExecArray | null;
			while ((csvMatch = csvPattern.exec(storeHtml)) !== null) {
				const href = csvMatch[1];
				const fileUrl = buildKtcFileUrl(href, portalUrl);
				if (seenUrls.has(fileUrl)) {
					continue;
				}
				seenUrls.add(fileUrl);
				const filename = this.extractFilenameFromUrl(fileUrl);
				const fileDate = this.extractDateFromFilename(filename);
				if (filterDate && fileDate && fileDate !== filterDate) {
					continue;
				}
				const lastModified = fileDate ? new Date(fileDate) : undefined;
				discovered.push({
					url: fileUrl,
					filename,
					type: "csv",
					lastModified,
					metadata: {
						source: "ktc_portal",
						discoveredAt: new Date().toISOString(),
						storeName,
						portalDate: fileDate,
						skipOn404: "true",
					},
				});
			}
		}

		if (discovered.length === 0) {
			this.collectDirectCsvLinks(
				html,
				portalUrl,
				filterDate,
				discovered,
				seenUrls,
			);
		}

		return ok(discovered);
	}

	private resolvePortalUrl(): ResultAsync<string, FetchError> {
		return new ResultAsync(this.resolvePortalUrlImpl());
	}

	private async resolvePortalUrlImpl(): Promise<Result<string, FetchError>> {
		const urlsToTry = new Set<string>([
			this.baseUrl(),
			...KtcAdapter.portalUrls,
		]);
		let lastError: string | undefined;
		let lastUrl: string | undefined;
		for (const url of urlsToTry) {
			lastUrl = url;
			const responseResult = await this.fetchWithRetry(url);
			if (responseResult.isOk()) {
				return ok(url);
			}
			if (responseResult.error.status) {
				lastError = `status ${responseResult.error.status} from ${url}`;
			} else {
				lastError = responseResult.error.message;
			}
		}
		return err(
			fetchError({
				url: lastUrl ?? this.baseUrl(),
				message: `Failed to resolve KTC portal URL: ${lastError ?? "unknown"}`,
				retryable: true,
				attempts: urlsToTry.size,
			}),
		);
	}

	private collectDirectCsvLinks(
		html: string,
		portalUrl: string,
		filterDate: string,
		discovered: DiscoveredFile[],
		seenUrls: Set<string>,
	): void {
		const csvPattern = /href=["']([^"']*\.csv(?:\?[^"']*)?)["']/gi;
		let csvMatch: RegExpExecArray | null;
		while ((csvMatch = csvPattern.exec(html)) !== null) {
			const href = csvMatch[1];
			const fileUrl = buildKtcFileUrl(href, portalUrl);
			if (seenUrls.has(fileUrl)) {
				continue;
			}
			seenUrls.add(fileUrl);
			const filename = this.extractFilenameFromUrl(fileUrl);
			const fileDate = this.extractDateFromFilename(filename);
			if (filterDate && fileDate && fileDate !== filterDate) {
				continue;
			}
			discovered.push({
				url: fileUrl,
				filename,
				type: "csv",
				lastModified: fileDate ? new Date(fileDate) : undefined,
				metadata: {
					source: "ktc_portal",
					discoveredAt: new Date().toISOString(),
					portalDate: fileDate,
					skipOn404: "true",
				},
			});
		}
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		const match = filename.match(/(PJ[\dA-Z]+-\d+)-\d{8}-\d{6}\.csv$/);
		if (match?.[1]) {
			return match[1];
		}
		const simpleMatch = filename.match(/(PJ[\dA-Z]+)-\d+-\d{8}/);
		if (simpleMatch?.[1]) {
			return simpleMatch[1];
		}
		return super.extractStoreIdentifierFromFilename(filename);
	}

	protected postprocessResult(result: ParseResult): ParseResult {
		const warnings = [...result.warnings];
		const rows = result.rows.map((row) => {
			if (row.barcodes.length === 0) {
				return row;
			}

			const deduped: string[] = [];
			const seen = new Set<string>();

			for (const barcode of row.barcodes) {
				const normalized = normalizeKtcBarcode(barcode);
				if (!normalized) {
					warnings.push({
						rowNumber: row.rowNumber,
						field: "barcodes",
						message: `Dropped invalid KTC barcode: ${barcode}`,
					});
					continue;
				}

				if (seen.has(normalized)) {
					continue;
				}
				seen.add(normalized);
				deduped.push(normalized);
			}

			return {
				...row,
				barcodes: deduped,
			};
		});

		return {
			...result,
			rows,
			warnings,
		};
	}

	private extractDateFromFilename(filename: string): string {
		const match = filename.match(/(\d{4})(\d{2})(\d{2})-\d{6}\.csv$/);
		if (match) {
			return `${match[1]}-${match[2]}-${match[3]}`;
		}
		return "";
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
}

function safeDecodeURIComponent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function buildKtcFileUrl(href: string, portalUrl: string): string {
	const resolved = resolveKtcHref(href, portalUrl);
	if (!resolved) {
		return href;
	}

	try {
		const parsed = new URL(resolved);
		parsed.pathname = parsed.pathname
			.split("/")
			.map((segment) =>
				segment ? encodePathSegment(safeDecodeURIComponent(segment)) : "",
			)
			.join("/");
		return parsed.toString();
	} catch {
		return resolved;
	}
}

function resolveKtcHref(href: string, portalUrl: string): string | null {
	try {
		return new URL(href, portalUrl).toString();
	} catch {
		return null;
	}
}

function normalizeKtcBarcode(value: string): string | null {
	const digitsOnly = value.replace(/[^0-9]/g, "");
	if (digitsOnly.length < 8 || digitsOnly.length > 14) {
		return null;
	}
	return digitsOnly;
}

function encodePathSegment(segment: string): string {
	return encodeURIComponent(segment).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}
