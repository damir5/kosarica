import type { ResultAsync } from "neverthrow";
import type { FetchError } from "@/lib/errors";
import type { IngestionClassified } from "../errors";
import type {
	DiscoveredFile,
	ExpandedFile,
	FetchedFile,
	FileType,
	NormalizedRow,
	NormalizedRowValidation,
	ParseOptions,
	ParseResult,
	StoreIdentifier,
	StoreMetadata,
} from "../types";

export interface ChainAdapter {
	slug: string;
	name: string;
	supportedTypes: FileType[];
	discover(
		targetDate?: string,
	): ResultAsync<DiscoveredFile[], FetchError | IngestionClassified>;
	fetch(file: DiscoveredFile): ResultAsync<FetchedFile, FetchError>;
	parse(
		content: Buffer,
		filename: string,
		options?: ParseOptions,
	): ResultAsync<ParseResult, FetchError>;
	extractStoreIdentifier(file: DiscoveredFile): StoreIdentifier | null;
	validateRow(row: NormalizedRow): NormalizedRowValidation;
	extractStoreMetadata(file: DiscoveredFile): StoreMetadata | null;
	expandZip?(content: Buffer, filename: string): Promise<ExpandedFile[]>;
}
