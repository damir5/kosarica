import { ResultAsync } from "neverthrow";
import { fetchError, type FetchError } from "@/lib/errors";
import {
	newHeaderIndex,
	newNumericIndex,
	type XlsxColumnMapping,
	XlsxParser,
	type XlsxParserOptions,
} from "../../parsers/xlsx";
import type { ParseOptions, ParseResult } from "../../types";
import { type BaseAdapterConfig, BaseChainAdapter } from "./chain";

export interface XlsxAdapterConfig {
	baseConfig: BaseAdapterConfig;
	columnMapping: XlsxColumnMapping;
	alternativeColumnMapping?: XlsxColumnMapping;
	hasHeader: boolean;
	headerRowCount: number;
	defaultStoreIdentifier?: string;
}

export class BaseXlsxAdapter extends BaseChainAdapter {
	protected xlsxParser: XlsxParser;
	protected columnMapping: XlsxColumnMapping;
	protected altMapping?: XlsxColumnMapping;
	protected hasHeader: boolean;
	protected headerRowCount: number;
	protected defaultStoreIdentifier: string;

	constructor(cfg: XlsxAdapterConfig) {
		super({
			...cfg.baseConfig,
			fileExtensionPattern:
				cfg.baseConfig.fileExtensionPattern ?? /\.(xlsx|xls|XLSX|XLS)$/,
		});

		this.columnMapping = cfg.columnMapping;
		this.altMapping = cfg.alternativeColumnMapping;
		this.hasHeader = cfg.hasHeader;
		this.headerRowCount = cfg.headerRowCount;
		this.defaultStoreIdentifier = cfg.defaultStoreIdentifier ?? "";

		this.xlsxParser = new XlsxParser({
			columnMapping: cfg.columnMapping,
			hasHeader: cfg.hasHeader,
			headerRowCount: cfg.headerRowCount,
			defaultStoreIdentifier: cfg.defaultStoreIdentifier,
			skipEmptyRows: true,
		});
		this.xlsxParser.setAlternativeMapping(cfg.alternativeColumnMapping);
	}

	parse(
		content: Buffer,
		filename: string,
		_options?: ParseOptions,
	): ResultAsync<ParseResult, FetchError> {
		return ResultAsync.fromPromise(
			Promise.resolve().then(() => {
				const processed = this.preprocessContent(content);
				const storeIdentifier =
					this.defaultStoreIdentifier ||
					this.extractStoreIdentifierFromFilename(filename);
				const result = this.xlsxParser.parseWithStoreId(
					processed,
					storeIdentifier,
				);
				return result;
			}),
			(e) =>
				fetchError({
					url: filename,
					message: e instanceof Error ? e.message : "XLSX parse failed",
					retryable: false,
					attempts: 0,
					cause: e,
				}),
		)
			.map((result) => this.postprocessResult(result));
	}

	protected preprocessContent(content: Buffer): Buffer {
		return content;
	}

	protected postprocessResult(result: ParseResult): ParseResult {
		return result;
	}

	setParserOptions(options: XlsxParserOptions): void {
		this.xlsxParser.setOptions(options);
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
}

export { newHeaderIndex, newNumericIndex };
