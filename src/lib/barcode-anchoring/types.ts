export type BarcodeClass =
	| "valid_ean13"
	| "valid_ean8"
	| "variable_weight"
	| "internal_code"
	| "unknown";

export interface BarcodeClusterItem {
	retailerItemId: string;
	chainSlug: string | null;
	name: string;
	category: string | null;
	totalAmount: number | null;
	extractedUnit: string | null;
}

export interface BarcodeCluster {
	barcode: string;
	barcodeClass: BarcodeClass;
	items: BarcodeClusterItem[];
	chainCount: number;
	itemCount: number;
	categoryAgreement: number;
	quantityAgreement: number;
	priceVariance: number | null;
	priorityScore: number;
}

export interface BarcodeSourceRow {
	barcode: string;
	barcodeClass: string | null;
	retailerItemId: string;
	chainSlug: string | null;
	name: string;
	category: string | null;
	totalAmount: number | null;
	extractedUnit: string | null;
}

export interface BuildBarcodeClusterQueueOptions {
	limit?: number;
	minChains?: number;
}

export interface ProcessBarcodeClustersOptions
	extends BuildBarcodeClusterQueueOptions {
	dryRun?: boolean;
	createdBy?: string | null;
}

export interface ProcessBarcodeClustersResult {
	processed: number;
	autoLinked: number;
	triageQueued: number;
	skipped: number;
}
