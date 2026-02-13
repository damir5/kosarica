import { errAsync, ResultAsync } from "neverthrow";
import { type FetchError, fetchError } from "@/lib/errors";
import { type CsvColumnMapping, CsvParser } from "../../parsers/csv";
import type { ParseOptions, ParseResult } from "../../types";
import { type BaseAdapterConfig, BaseChainAdapter } from "./chain";

export interface CsvAdapterConfig {
	baseConfig: BaseAdapterConfig;
	columnMapping: CsvColumnMapping;
	alternativeColumnMapping?: CsvColumnMapping;
}

export class BaseCsvAdapter extends BaseChainAdapter {
	protected csvParser: CsvParser;
	protected columnMapping: CsvColumnMapping;
	protected altMapping?: CsvColumnMapping;
	private csvConfigError: FetchError | null = null;

	constructor(cfg: CsvAdapterConfig) {
		super({
			...cfg.baseConfig,
			fileExtensionPattern:
				cfg.baseConfig.fileExtensionPattern ?? /\.(csv|CSV)$/,
		});

		const csvConfig = cfg.baseConfig.chainConfig.csv;
		this.csvConfigError = csvConfig
			? null
			: fetchError({
					url: cfg.baseConfig.chainConfig.baseUrl,
					message: `${cfg.baseConfig.name}: CSV adapter requires CSV configuration`,
					retryable: false,
					attempts: 0,
				});

		this.columnMapping = cfg.columnMapping;
		this.altMapping = cfg.alternativeColumnMapping;

		this.csvParser = new CsvParser({
			delimiter: csvConfig?.delimiter ?? ",",
			encoding: csvConfig?.encoding ?? "auto",
			hasHeader: csvConfig?.hasHeader ?? true,
			columnMapping: cfg.columnMapping,
			skipEmptyRows: true,
			quoteChar: '"',
		});
		this.csvParser.setAlternativeMapping(cfg.alternativeColumnMapping);
	}

	parse(
		content: Buffer,
		filename: string,
		_options?: ParseOptions,
	): ResultAsync<ParseResult, FetchError> {
		if (this.csvConfigError) {
			return errAsync(this.csvConfigError);
		}

		return ResultAsync.fromPromise(
			Promise.resolve().then(() => {
				const processed = this.preprocessContent(content);
				const storeIdentifier =
					this.extractStoreIdentifierFromFilename(filename);
				const result = this.csvParser.parseWithStoreId(
					processed,
					storeIdentifier,
				);
				return result;
			}),
			(e) =>
				fetchError({
					url: filename,
					message: e instanceof Error ? e.message : "CSV parse failed",
					retryable: false,
					attempts: 0,
					cause: e,
				}),
		).map((result) => this.postprocessResult(result));
	}

	protected preprocessContent(content: Buffer): Buffer {
		return content;
	}

	protected postprocessResult(result: ParseResult): ParseResult {
		return result;
	}
}
