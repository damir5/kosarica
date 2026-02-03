import type { ParseOptions, ParseResult } from "../../types";
import { CsvParser, type CsvColumnMapping } from "../../parsers/csv";
import { BaseChainAdapter, type BaseAdapterConfig } from "./chain";

export interface CsvAdapterConfig {
	baseConfig: BaseAdapterConfig;
	columnMapping: CsvColumnMapping;
	alternativeColumnMapping?: CsvColumnMapping;
}

export class BaseCsvAdapter extends BaseChainAdapter {
	protected csvParser: CsvParser;
	protected columnMapping: CsvColumnMapping;
	protected altMapping?: CsvColumnMapping;

	constructor(cfg: CsvAdapterConfig) {
		super({
			...cfg.baseConfig,
			fileExtensionPattern:
				cfg.baseConfig.fileExtensionPattern ?? /\.(csv|CSV)$/,
		});

		if (!cfg.baseConfig.chainConfig.csv) {
			throw new Error(`${cfg.baseConfig.name}: CSV adapter requires CSV configuration`);
		}

		this.columnMapping = cfg.columnMapping;
		this.altMapping = cfg.alternativeColumnMapping;

		this.csvParser = new CsvParser({
			delimiter: cfg.baseConfig.chainConfig.csv.delimiter,
			encoding: cfg.baseConfig.chainConfig.csv.encoding,
			hasHeader: cfg.baseConfig.chainConfig.csv.hasHeader,
			columnMapping: cfg.columnMapping,
			skipEmptyRows: true,
			quoteChar: '"',
		});
		this.csvParser.setAlternativeMapping(cfg.alternativeColumnMapping);
	}

	async parse(content: Buffer, filename: string, _options?: ParseOptions): Promise<ParseResult> {
		const processed = this.preprocessContent(content);
		const storeIdentifier = this.extractStoreIdentifierFromFilename(filename);
		const result = this.csvParser.parseWithStoreId(processed, storeIdentifier);
		return this.postprocessResult(result);
	}

	protected preprocessContent(content: Buffer): Buffer {
		return content;
	}

	protected postprocessResult(result: ParseResult): ParseResult {
		return result;
	}
}
