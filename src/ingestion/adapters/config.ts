import type { CsvDelimiter, CsvEncoding } from "../parsers/csv";
import type { FileType } from "../types";

export type ChainID =
	| "konzum"
	| "lidl"
	| "plodine"
	| "interspar"
	| "studenac"
	| "kaufland"
	| "eurospin"
	| "dm"
	| "ktc"
	| "metro"
	| "trgocentar";

export interface CsvConfig {
	delimiter: CsvDelimiter;
	encoding: CsvEncoding;
	hasHeader: boolean;
}

export interface ChainConfig {
	id: ChainID;
	name: string;
	baseUrl: string;
	primaryFileType: FileType;
	supportedTypes: FileType[];
	csv?: CsvConfig;
	usesZip: boolean;
	storeResolution: "filename" | "portal_id" | "national";
	metadata?: Record<string, string>;
}

export const chainConfigs: Record<ChainID, ChainConfig> = {
	konzum: {
		id: "konzum",
		name: "Konzum",
		baseUrl: "https://www.konzum.hr/cjenici",
		primaryFileType: "csv",
		supportedTypes: ["csv"],
		csv: { delimiter: ",", encoding: "utf-8", hasHeader: true },
		usesZip: false,
		storeResolution: "filename",
	},
	lidl: {
		id: "lidl",
		name: "Lidl",
		baseUrl: "https://tvrtka.lidl.hr/cijene",
		primaryFileType: "csv",
		supportedTypes: ["csv", "zip"],
		csv: { delimiter: ",", encoding: "windows-1250", hasHeader: true },
		usesZip: true,
		storeResolution: "filename",
	},
	plodine: {
		id: "plodine",
		name: "Plodine",
		baseUrl: "https://www.plodine.hr/info-o-cijenama",
		primaryFileType: "csv",
		supportedTypes: ["csv", "zip"],
		csv: { delimiter: ";", encoding: "windows-1250", hasHeader: true },
		usesZip: true,
		storeResolution: "filename",
	},
	interspar: {
		id: "interspar",
		name: "Interspar",
		baseUrl: "https://www.spar.hr/usluge/cjenici",
		primaryFileType: "csv",
		supportedTypes: ["csv"],
		csv: { delimiter: ";", encoding: "utf-8", hasHeader: true },
		usesZip: false,
		storeResolution: "filename",
	},
	studenac: {
		id: "studenac",
		name: "Studenac",
		baseUrl: "https://www.studenac.hr/popis-maloprodajnih-cijena",
		primaryFileType: "zip",
		supportedTypes: ["xml", "zip"],
		usesZip: true,
		storeResolution: "portal_id",
	},
	kaufland: {
		id: "kaufland",
		name: "Kaufland",
		baseUrl: "https://www.kaufland.hr/akcije-novosti/popis-mpc.html",
		primaryFileType: "csv",
		supportedTypes: ["csv"],
		csv: { delimiter: "\t", encoding: "utf-8", hasHeader: true },
		usesZip: false,
		storeResolution: "filename",
	},
	eurospin: {
		id: "eurospin",
		name: "Eurospin",
		baseUrl: "https://www.eurospin.hr/cjenik/",
		primaryFileType: "csv",
		supportedTypes: ["csv", "zip"],
		csv: { delimiter: ";", encoding: "utf-8", hasHeader: true },
		usesZip: true,
		storeResolution: "filename",
	},
	dm: {
		id: "dm",
		name: "DM",
		baseUrl:
			"https://www.dm.hr/novo/promocije/nove-oznake-cijena-i-vazeci-cjenik-u-dm-u-2906632",
		primaryFileType: "xlsx",
		supportedTypes: ["xlsx"],
		usesZip: false,
		storeResolution: "national",
	},
	ktc: {
		id: "ktc",
		name: "KTC",
		baseUrl: "http://www.ktc.hr/cjenici",
		primaryFileType: "csv",
		supportedTypes: ["csv"],
		csv: { delimiter: ";", encoding: "windows-1250", hasHeader: true },
		usesZip: false,
		storeResolution: "filename",
	},
	metro: {
		id: "metro",
		name: "Metro",
		baseUrl: "https://metrocjenik.com.hr/",
		primaryFileType: "csv",
		supportedTypes: ["csv"],
		csv: { delimiter: ",", encoding: "utf-8", hasHeader: true },
		usesZip: false,
		storeResolution: "portal_id",
	},
	trgocentar: {
		id: "trgocentar",
		name: "Trgocentar",
		baseUrl: "https://trgocentar.com/Trgovine-cjenik/",
		primaryFileType: "xml",
		supportedTypes: ["xml"],
		usesZip: false,
		storeResolution: "filename",
	},
};

export const chainIds: ChainID[] = Object.keys(chainConfigs) as ChainID[];

export function getChainConfig(chainId: ChainID): ChainConfig {
	return chainConfigs[chainId];
}
