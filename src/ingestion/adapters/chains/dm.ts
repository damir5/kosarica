import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { ResultAsync, errAsync, okAsync } from "neverthrow";
import * as XLSX from "xlsx";
import { fetchError, type FetchError } from "@/lib/errors";
import { ingestionClassified, type IngestionClassified } from "@/ingestion/errors";
import { formatDateInTimezone, ZAGREB_TIMEZONE } from "@/ingestion/time";
import type { XlsxColumnMapping } from "../../parsers/xlsx";
import type {
	DiscoveredFile,
	FetchedFile,
	ParseOptions,
	ParseResult,
	StoreIdentifier,
	StoreMetadata,
} from "../../types";
import { BaseXlsxAdapter, newHeaderIndex, newNumericIndex } from "../base/xlsx";
import { chainConfigs } from "../config";

const dmPortalURL =
	"https://www.dm.hr/novo/promocije/nove-oznake-cijena-i-vazeci-cjenik-u-dm-u-2906632";
const dmPriceListURL =
	"https://content.services.dmtech.com/rootpage-dm-shop-hr-hr/resource/blob/3245770/0a2d2d47073cad06c1f3a8d4fbba2e50/vlada-oznacavanje-cijena-cijenik-236-data.xlsx";
const dmNationalStoreIdentifier = "dm_national";
const dmSourceMode = "snapshot";

const dmWebColumnMapping: XlsxColumnMapping = {
	name: newNumericIndex(0),
	externalId: newNumericIndex(1),
	brand: newNumericIndex(2),
	barcodes: newNumericIndex(3),
	category: newNumericIndex(4),
	unitQuantity: newNumericIndex(5),
	unit: newNumericIndex(6),
	unitPrice: newNumericIndex(7),
	price: newNumericIndex(9),
	discountPrice: newNumericIndex(10),
	lowestPrice30d: newNumericIndex(11),
	anchorPrice: newNumericIndex(12),
};

const dmLocalColumnMapping: XlsxColumnMapping = {
	externalId: newHeaderIndex("Šifra"),
	name: newHeaderIndex("Naziv"),
	category: newHeaderIndex("Kategorija"),
	brand: newHeaderIndex("Marka"),
	unit: newHeaderIndex("Mjerna jedinica"),
	unitQuantity: newHeaderIndex("Količina"),
	price: newHeaderIndex("Cijena"),
	discountPrice: newHeaderIndex("Akcijska cijena"),
	discountStart: newHeaderIndex("Početak akcije"),
	discountEnd: newHeaderIndex("Kraj akcije"),
	barcodes: newHeaderIndex("Barkod"),
	unitPrice: newHeaderIndex("Cijena za jedinicu mjere"),
	lowestPrice30d: newHeaderIndex("Najniža cijena u zadnjih 30 dana"),
	anchorPrice: newHeaderIndex("Sidrena cijena"),
	unitPriceBaseQuantity: newHeaderIndex("Količina za jedinicu mjere"),
	unitPriceBaseUnit: newHeaderIndex("Jedinica mjere za cijenu"),
	anchorPriceAsOf: newHeaderIndex("Datum sidrene cijene"),
};

const dmLocalColumnMappingAlt: XlsxColumnMapping = {
	externalId: newHeaderIndex("Sifra"),
	name: newHeaderIndex("Naziv artikla"),
	category: newHeaderIndex("Kategorija"),
	brand: newHeaderIndex("Marka"),
	unit: newHeaderIndex("JM"),
	unitQuantity: newHeaderIndex("Kolicina"),
	price: newHeaderIndex("Cijena"),
	discountPrice: newHeaderIndex("Akcija"),
	discountStart: newHeaderIndex("Pocetak akcije"),
	discountEnd: newHeaderIndex("Kraj akcije"),
	barcodes: newHeaderIndex("EAN"),
	unitPrice: newHeaderIndex("Cijena za jedinicu mjere"),
	lowestPrice30d: newHeaderIndex("Najniza cijena u zadnjih 30 dana"),
	anchorPrice: newHeaderIndex("Sidrena cijena"),
	unitPriceBaseQuantity: newHeaderIndex("Kolicina za JM"),
	unitPriceBaseUnit: newHeaderIndex("JM za cijenu"),
	anchorPriceAsOf: newHeaderIndex("Datum sidrene cijene"),
};

export class DmAdapter extends BaseXlsxAdapter {
	private discoveryDate?: string;

	constructor() {
		const chainConfig = chainConfigs.dm;
		super({
			baseConfig: {
				slug: chainConfig.id,
				name: chainConfig.name,
				supportedTypes: chainConfig.supportedTypes,
				chainConfig,
				filenamePrefixPatterns: [
					"(?i)^DM[_-]?",
					"(?i)^dm[_-]?",
					"(?i)^cjenik[_-]?",
					"(?i)^vlada-oznacavanje",
				],
			},
			columnMapping: dmWebColumnMapping,
			alternativeColumnMapping: dmLocalColumnMapping,
			hasHeader: false,
			headerRowCount: 3,
			defaultStoreIdentifier: dmNationalStoreIdentifier,
		});
	}

	setDiscoveryDate(date: string): void {
		this.discoveryDate = date;
	}

	discover(
		targetDate?: string,
	): ResultAsync<DiscoveredFile[], FetchError | IngestionClassified> {
		let requestedDate = targetDate || this.discoveryDate;
		if (!requestedDate) {
			requestedDate = formatDateInTimezone(new Date(), ZAGREB_TIMEZONE);
		}

		return this.fetchWithRetry(dmPriceListURL)
			.andThen((response) =>
				ResultAsync.fromPromise(response.arrayBuffer(), (e) =>
					fetchError({
						url: dmPriceListURL,
						message:
							e instanceof Error ? e.message : "Failed to read response body",
						retryable: false,
						attempts: 1,
						cause: e,
					}),
				).map((arrayBuffer) => ({
					response,
					body: Buffer.from(arrayBuffer),
				})),
			)
			.andThen(({ response, body }) => {
				const inferredDate = inferDateFromXlsxContent(body);

				const contentLength = response.headers.get("Content-Length");
				const lastModified = response.headers.get("Last-Modified");
				const urlParts = dmPriceListURL.split("/");
				const urlFilename = urlParts[urlParts.length - 1] || "dm-cjenik.xlsx";

				let size: number | undefined;
				if (contentLength) {
					const parsed = Number.parseInt(contentLength, 10);
					if (!Number.isNaN(parsed) && parsed > 0) {
						size = parsed;
					}
				}
				if (!size && body.length > 0) {
					size = body.length;
				}

				let modTime: Date | undefined;
				if (lastModified) {
					const parsed = Date.parse(lastModified);
					if (!Number.isNaN(parsed)) {
						modTime = new Date(parsed);
					}
				}
				if (!modTime) {
					modTime = new Date();
				}
				const resolvedSnapshotDate =
					inferredDate || formatDateInTimezone(modTime, ZAGREB_TIMEZONE);

				if (requestedDate && requestedDate !== resolvedSnapshotDate) {
					return errAsync(
						ingestionClassified({
							status: "completed",
							statusType: "source_snapshot_mismatch",
							statusSeverity: "warning",
							statusReason: `DM source is snapshot-only: requested ${requestedDate}, resolved snapshot date ${resolvedSnapshotDate}`,
							metadata: {
								sourceMode: dmSourceMode,
								requestedTargetDate: requestedDate,
								resolvedSnapshotDate,
								sourceUrl: dmPriceListURL,
								timezone: ZAGREB_TIMEZONE,
							},
						}),
					);
				}

				const files: DiscoveredFile[] = [
					{
						url: dmPriceListURL,
						filename: urlFilename,
						type: "xlsx",
						size,
						lastModified: modTime,
						metadata: {
							source: "dm_web",
							discoveredAt: new Date().toISOString(),
							portalUrl: dmPortalURL,
							portalDate: resolvedSnapshotDate,
							sourceMode: dmSourceMode,
						},
					},
				];

				return okAsync(files);
			})
			.orElse((error) => {
				if (error._tag === "FetchError" && error.status === 404) {
					return okAsync<DiscoveredFile[]>([]);
				}
				return errAsync(error);
			});
	}

	fetch(file: DiscoveredFile): ResultAsync<FetchedFile, FetchError> {
		if (file.url.startsWith("file://")) {
			const filePath = file.url.replace("file://", "");
			return ResultAsync.fromPromise(fs.readFile(filePath), (error) =>
				fetchError({
					url: file.url,
					message:
						error instanceof Error ? error.message : "Failed to read file",
					retryable: false,
					attempts: 1,
					cause: error,
				}),
			).map((content) => ({
				discovered: file,
				content,
				hash: computeHash(content),
			}));
		}
		return super.fetch(file);
	}

	parse(
		content: Buffer,
		filename: string,
		options?: ParseOptions,
	): ResultAsync<ParseResult, FetchError> {
		const storeIdentifier = dmNationalStoreIdentifier;
		const isWebFormat =
			filename.includes("vlada-oznacavanje") || filename.includes("cijenik-");

		if (isWebFormat) {
			this.setParserOptions({
				columnMapping: dmWebColumnMapping,
				hasHeader: false,
				headerRowCount: 3,
				defaultStoreIdentifier: storeIdentifier,
				skipEmptyRows: true,
			});
			return super.parse(content, filename, options);
		}

		this.setParserOptions({
			columnMapping: dmLocalColumnMapping,
			hasHeader: true,
			headerRowCount: 0,
			defaultStoreIdentifier: storeIdentifier,
			skipEmptyRows: true,
		});

		return super.parse(content, filename, options).andThen((result) => {
			if (result.validRows === 0 && result.errors.length > 0) {
				this.setParserOptions({
					columnMapping: dmLocalColumnMappingAlt,
					hasHeader: true,
					headerRowCount: 0,
					defaultStoreIdentifier: storeIdentifier,
					skipEmptyRows: true,
				});
				return super.parse(content, filename, options);
			}
			return okAsync(result);
		});
	}

	extractStoreIdentifier(_file: DiscoveredFile): StoreIdentifier | null {
		return { type: "national", value: dmNationalStoreIdentifier };
	}

	extractStoreMetadata(_file: DiscoveredFile): StoreMetadata | null {
		return { name: "DM National", storeType: "national" };
	}
}

function inferDateFromXlsxContent(content: Buffer): string {
	try {
		const workbook = XLSX.read(content, { type: "buffer" });
		const sheetName = workbook.SheetNames[0];
		if (!sheetName) {
			return "";
		}
		const sheet = workbook.Sheets[sheetName];
		const rows = XLSX.utils.sheet_to_json(sheet, {
			header: 1,
			defval: "",
			raw: false,
		}) as string[][];
		const maxRows = Math.min(rows.length, 10);
		for (let i = 0; i < maxRows; i += 1) {
			const row = rows[i] ?? [];
			const maxCols = Math.min(row.length, 8);
			for (let j = 0; j < maxCols; j += 1) {
				const date = extractDateFromText(String(row[j] ?? ""));
				if (date) {
					return date;
				}
			}
		}
	} catch {
		return "";
	}
	return "";
}

function extractDateFromText(text: string): string {
	const value = text.trim();
	if (!value) {
		return "";
	}
	const isoMatch = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
	if (isoMatch) {
		return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
	}
	const dotMatch = value.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
	if (dotMatch) {
		return `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;
	}
	const slashMatch = value.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
	if (slashMatch) {
		return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
	}
	return "";
}

function computeHash(content: Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}
