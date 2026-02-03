import type {
	DiscoveredFile,
	ExpandedFile,
	FetchedFile,
	NormalizedRow,
	NormalizedRowValidation,
	ParseOptions,
	ParseResult,
	StoreIdentifier,
	StoreMetadata,
	FileType,
} from "../types";

export interface ChainAdapter {
	slug: string;
	name: string;
	supportedTypes: FileType[];
	discover(targetDate?: string): Promise<DiscoveredFile[]>;
	fetch(file: DiscoveredFile): Promise<FetchedFile>;
	parse(content: Buffer, filename: string, options?: ParseOptions): Promise<ParseResult>;
	extractStoreIdentifier(file: DiscoveredFile): StoreIdentifier | null;
	validateRow(row: NormalizedRow): NormalizedRowValidation;
	extractStoreMetadata(file: DiscoveredFile): StoreMetadata | null;
	expandZip?(content: Buffer, filename: string): Promise<ExpandedFile[]>;
}
