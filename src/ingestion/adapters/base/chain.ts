import { createHash } from "node:crypto";
import type { Result } from "neverthrow";
import { err, errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import { type FetchError, fetchError } from "@/lib/errors";
import type { IngestionClassified } from "../../errors";
import type {
	DiscoveredFile,
	FetchedFile,
	FileType,
	NormalizedRow,
	NormalizedRowValidation,
	ParseOptions,
	ParseResult,
	StoreIdentifier,
	StoreMetadata,
} from "../../types";
import type { ChainConfig } from "../config";

export interface RateLimitConfig {
	requestsPerSecond: number;
	maxRetries: number;
	initialBackoffMs: number;
	maxBackoffMs: number;
}

export interface PartialRateLimitConfig {
	requestsPerSecond?: number;
	maxRetries?: number;
	initialBackoffMs?: number;
	maxBackoffMs?: number;
}

export interface BaseAdapterConfig {
	slug: string;
	name: string;
	supportedTypes: FileType[];
	chainConfig: ChainConfig;
	filenamePrefixPatterns?: string[];
	fileExtensionPattern?: RegExp;
	rateLimitOverrides?: PartialRateLimitConfig;
}

const defaultRateLimitConfig: RateLimitConfig = {
	requestsPerSecond: 2,
	maxRetries: 3,
	initialBackoffMs: 100,
	maxBackoffMs: 30_000,
};

class RateLimiter {
	private config: RateLimitConfig;
	private lastRequest: number;

	constructor(config: RateLimitConfig) {
		this.config = config;
		this.lastRequest = 0;
	}

	getConfig(): RateLimitConfig {
		return this.config;
	}

	async throttle(): Promise<void> {
		const now = Date.now();
		const minInterval = 1000 / this.config.requestsPerSecond;
		const elapsed = now - this.lastRequest;
		if (elapsed < minInterval) {
			await sleep(minInterval - elapsed);
		}
		this.lastRequest = Date.now();
	}
}

export class BaseChainAdapter {
	slug: string;
	name: string;
	supportedTypes: FileType[];
	protected config: ChainConfig;
	protected filenamePrefixPatterns: RegExp[];
	protected fileExtensionPattern: RegExp;
	protected rateLimiter: RateLimiter;
	protected rateLimitConfig: RateLimitConfig;
	protected initializationError: FetchError | null;

	constructor(cfg: BaseAdapterConfig) {
		const configuredTypes = cfg.supportedTypes.length
			? cfg.supportedTypes
			: cfg.chainConfig.supportedTypes;
		this.initializationError =
			configuredTypes.length === 0
				? fetchError({
						url: cfg.chainConfig.baseUrl,
						message: `${cfg.slug}: supportedTypes cannot be empty`,
						retryable: false,
						attempts: 0,
					})
				: null;

		this.slug = cfg.slug;
		this.name = cfg.name;
		this.supportedTypes = configuredTypes.length > 0 ? configuredTypes : ["csv"];
		this.config = cfg.chainConfig;

		this.fileExtensionPattern = cfg.fileExtensionPattern ?? /\.(csv|CSV)$/;

		const prefixPatterns = cfg.filenamePrefixPatterns ?? [];
		this.filenamePrefixPatterns = prefixPatterns
			.map((pattern) => compilePattern(pattern))
			.concat(
				prefixPatterns.length === 0
					? [
							new RegExp(`^${escapeRegex(this.name)}[_-]?`, "i"),
							/^cjenik[_-]?/i,
						]
					: [],
			);

		this.rateLimitConfig = {
			...defaultRateLimitConfig,
			...cfg.rateLimitOverrides,
		};
		this.rateLimiter = new RateLimiter(this.rateLimitConfig);
	}

	baseUrl(): string {
		return this.config.baseUrl;
	}

	discover(
		_targetDate?: string,
	): ResultAsync<DiscoveredFile[], FetchError | IngestionClassified> {
		if (this.initializationError) {
			return errAsync(this.initializationError);
		}

		return this.fetchWithRetry(this.config.baseUrl)
			.andThen((response) =>
				ResultAsync.fromPromise(response.text(), (e) =>
					fetchError({
						url: this.config.baseUrl,
						message: e instanceof Error ? e.message : "Failed to read response",
						retryable: false,
						attempts: 1,
						cause: e,
					}),
				),
			)
			.andThen((html) => {
				const extensions = this.getDiscoverableExtensions();
				const extensionPattern = extensions.join("|");
				const linkPattern = new RegExp(
					`href=["']([^"']*\\.(?:${extensionPattern})(?:\\?[^"']*)?)["']`,
					"gi",
				);

				const matches = html.matchAll(linkPattern);
				const seen = new Set<string>();
				const files: DiscoveredFile[] = [];

				for (const match of matches) {
					const href = match[1];
					if (!href || seen.has(href)) {
						continue;
					}
					seen.add(href);

					const fileUrl = resolveUrl(this.config.baseUrl, href);
					const filename = this.extractFilenameFromUrl(fileUrl);
					const type = this.detectFileType(filename);

					files.push({
						url: fileUrl,
						filename,
						type,
						metadata: {
							source: `${this.slug}_portal`,
							discoveredAt: new Date().toISOString(),
						},
					});
				}

				return okAsync(files);
			});
	}

	fetch(file: DiscoveredFile): ResultAsync<FetchedFile, FetchError> {
		if (this.initializationError) {
			return errAsync(this.initializationError);
		}

		return this.fetchWithRetry(file.url)
			.andThen((response) =>
				ResultAsync.fromPromise(response.arrayBuffer(), (e) =>
					fetchError({
						url: file.url,
						message:
							e instanceof Error ? e.message : "Failed to read response body",
						retryable: false,
						attempts: 1,
						cause: e,
					}),
				),
			)
			.map((arrayBuffer) => {
				const buffer = Buffer.from(arrayBuffer);
				return {
					discovered: file,
					content: buffer,
					hash: computeSha256(buffer),
				};
			});
	}

	parse(
		_content: Buffer,
		_filename: string,
		_options?: ParseOptions,
	): ResultAsync<ParseResult, FetchError> {
		if (this.initializationError) {
			return errAsync(this.initializationError);
		}

		return errAsync(
			fetchError({
				url: "",
				message: "Parse method must be implemented by subclass",
				retryable: false,
				attempts: 0,
			}),
		);
	}

	extractStoreIdentifier(file: DiscoveredFile): StoreIdentifier | null {
		const identifier = this.extractStoreIdentifierFromFilename(file.filename);
		if (!identifier) {
			return null;
		}
		return {
			type: "filename_code",
			value: identifier,
		};
	}

	validateRow(row: NormalizedRow): NormalizedRowValidation {
		const errors: string[] = [];
		const warnings: string[] = [];

		if (!row.name || row.name.trim() === "") {
			errors.push("Missing product name");
		}

		if (row.priceStatus === "available") {
			if (row.price === null || row.price <= 0) {
				errors.push("Price must be positive when marked available");
			}
		} else if (row.price !== null && row.price > 0) {
			warnings.push("Unavailable row has a positive price value");
		}

		if (row.price !== null && row.price > 100_000_000) {
			warnings.push("Price seems unusually high");
		}

		if (
			row.price !== null &&
			row.discountPrice !== undefined &&
			row.discountPrice >= row.price
		) {
			warnings.push("Discount price is not less than regular price");
		}

		for (const barcode of row.barcodes) {
			if (!isValidBarcode(barcode)) {
				warnings.push(`Invalid barcode format: ${barcode}`);
			}
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
		};
	}

	extractStoreMetadata(file: DiscoveredFile): StoreMetadata | null {
		const identifier = this.extractStoreIdentifierFromFilename(file.filename);
		if (!identifier) {
			return null;
		}
		return {
			name: `${this.name} ${identifier}`,
		};
	}

	protected extractFilenameFromUrl(url: string): string {
		try {
			const parsed = new URL(url);
			const pathname = parsed.pathname;
			const parts = pathname.split("/");
			const filename = parts[parts.length - 1];
			return filename
				? filename.split("?")[0]
				: `unknown.${this.supportedTypes[0]}`;
		} catch {
			return `unknown.${this.supportedTypes[0]}`;
		}
	}

	protected detectFileType(filename: string): FileType {
		const lower = filename.toLowerCase();
		if (lower.endsWith(".csv")) return "csv";
		if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
		if (lower.endsWith(".xml")) return "xml";
		if (lower.endsWith(".zip")) return "zip";
		return this.supportedTypes[0];
	}

	protected getDiscoverableExtensions(): string[] {
		const extensions: string[] = [];
		for (const type of this.supportedTypes) {
			switch (type) {
				case "csv":
					extensions.push("csv");
					break;
				case "xlsx":
					extensions.push("xlsx", "xls");
					break;
				case "xml":
					extensions.push("xml");
					break;
				case "zip":
					extensions.push("zip");
					break;
			}
		}
		return extensions;
	}

	protected extractStoreIdentifierFromFilename(filename: string): string {
		const baseName = filename.replace(this.fileExtensionPattern, "");
		let cleanName = baseName;
		for (const pattern of this.filenamePrefixPatterns) {
			cleanName = cleanName.replace(pattern, "");
		}
		cleanName = cleanName.trim();
		if (!cleanName) {
			return filename.replace(this.fileExtensionPattern, "");
		}
		return cleanName;
	}

	protected fetchWithRetry(url: string): ResultAsync<Response, FetchError> {
		return new ResultAsync(this._fetchWithRetryImpl(url));
	}

	private async _fetchWithRetryImpl(
		url: string,
	): Promise<Result<Response, FetchError>> {
		let lastStatus = 0;
		let lastErrorMsg = "";

		for (
			let attempt = 0;
			attempt <= this.rateLimitConfig.maxRetries;
			attempt += 1
		) {
			await this.rateLimiter.throttle();

			try {
				const response = await fetch(url, {
					method: "GET",
					headers: {
						"User-Agent": "Kosarica-Ingestion/1.0",
						Accept: "*/*",
					},
				});

				lastStatus = response.status;
				if (response.ok) {
					return ok(response);
				}

				if (
					!isRetryableStatus(response.status) ||
					attempt === this.rateLimitConfig.maxRetries
				) {
					return err(
						fetchError({
							url,
							status: response.status,
							message: `HTTP ${response.status}: ${response.statusText}`,
							retryable: isRetryableStatus(response.status),
							attempts: attempt + 1,
						}),
					);
				}

				const retryAfter = response.headers.get("Retry-After") ?? undefined;
				const delay =
					response.status === 429
						? calculateRateLimitBackoff(
								attempt,
								this.rateLimitConfig,
								retryAfter,
							)
						: calculateBackoff(attempt, this.rateLimitConfig);
				await sleep(delay);
			} catch (error) {
				lastErrorMsg = error instanceof Error ? error.message : String(error);
				if (attempt === this.rateLimitConfig.maxRetries) {
					break;
				}
				const delay = calculateBackoff(attempt, this.rateLimitConfig);
				await sleep(delay);
			}
		}

		return err(
			fetchError({
				url,
				status: lastStatus || undefined,
				message:
					`Failed to fetch ${url} after ${this.rateLimitConfig.maxRetries + 1} attempts` +
					(lastStatus ? ` (HTTP ${lastStatus})` : "") +
					(lastErrorMsg ? `: ${lastErrorMsg}` : ""),
				retryable: true,
				attempts: this.rateLimitConfig.maxRetries + 1,
			}),
		);
	}
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compilePattern(pattern: string): RegExp {
	const trimmed = pattern.trim();
	if (trimmed.startsWith("(?i)")) {
		const cleaned = trimmed.replace("(?i)", "");
		return new RegExp(cleaned, "i");
	}
	return new RegExp(trimmed);
}

function computeSha256(content: Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

function isValidBarcode(barcode: string): boolean {
	if (barcode.length < 8 || barcode.length > 14) {
		return false;
	}
	return /^[0-9]+$/.test(barcode);
}

function isRetryableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

function calculateBackoff(attempt: number, config: RateLimitConfig): number {
	const exponential = config.initialBackoffMs * 2 ** attempt;
	const capped = Math.min(exponential, config.maxBackoffMs);
	return capped + Math.random() * 0.25 * capped;
}

function calculateRateLimitBackoff(
	attempt: number,
	config: RateLimitConfig,
	retryAfter?: string,
): number {
	if (retryAfter) {
		const seconds = Number.parseInt(retryAfter, 10);
		if (!Number.isNaN(seconds) && seconds > 0) {
			return seconds * 1000 + Math.random() * 1000;
		}
	}
	const exponential = config.initialBackoffMs * 3 ** attempt;
	const capped = Math.min(exponential, config.maxBackoffMs);
	return capped + Math.random() * 0.25 * capped;
}

function resolveUrl(baseUrl: string, href: string): string {
	if (href.startsWith("http://") || href.startsWith("https://")) {
		return href;
	}
	try {
		const base = new URL(baseUrl);
		if (href.startsWith("/")) {
			return `${base.protocol}//${base.host}${href}`;
		}
		const basePath = base.pathname;
		const prefix = basePath.includes("/")
			? basePath.slice(0, basePath.lastIndexOf("/") + 1)
			: "/";
		return `${base.protocol}//${base.host}${prefix}${href}`;
	} catch {
		return href;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
