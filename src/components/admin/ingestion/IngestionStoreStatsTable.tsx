import { Store } from "lucide-react";
import { useMemo } from "react";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export interface IngestionStoreStats {
	storeId?: string;
	storeIdentifier?: string;
	storeName?: string | null;
	storeCity?: string | null;
	rowCount?: number | null;
	persistedCount?: number | null;
	priceChanges?: number | null;
	failedRows?: number | null;
	warningRows?: number | null;
	fileCount?: number | null;
}

interface IngestionStoreStatsTableProps {
	stores: IngestionStoreStats[];
	isLoading?: boolean;
	showFileCount?: boolean;
	emptyLabel?: string;
}

const formatCount = (value?: number | null) => {
	if (value === null || value === undefined) return "-";
	return value.toLocaleString();
};

export function IngestionStoreStatsTable({
	stores,
	isLoading,
	showFileCount,
	emptyLabel = "No store stats available",
}: IngestionStoreStatsTableProps) {
	const skeletonKeys = useMemo(
		() => Array.from({ length: 6 }, () => crypto.randomUUID()),
		[],
	);

	if (isLoading) {
		return (
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Store</TableHead>
							<TableHead>Identifier</TableHead>
							<TableHead className="text-right">Rows</TableHead>
							<TableHead className="text-right">Persisted</TableHead>
							<TableHead className="text-right">Changes</TableHead>
							<TableHead className="text-right">Failed</TableHead>
							<TableHead className="text-right">Warnings</TableHead>
							{showFileCount && (
								<TableHead className="text-right">Files</TableHead>
							)}
						</TableRow>
					</TableHeader>
					<TableBody>
						{skeletonKeys.map((key) => (
							<TableRow key={key}>
								<TableCell colSpan={showFileCount ? 8 : 7}>
									<div className="h-8 bg-muted animate-pulse rounded" />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		);
	}

	if (stores.length === 0) {
		return (
			<div className="rounded-md border py-12 text-center">
				<Store className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
				<p className="text-muted-foreground">{emptyLabel}</p>
			</div>
		);
	}

	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Store</TableHead>
						<TableHead>Identifier</TableHead>
						<TableHead className="text-right">Rows</TableHead>
						<TableHead className="text-right">Persisted</TableHead>
						<TableHead className="text-right">Changes</TableHead>
						<TableHead className="text-right">Failed</TableHead>
						<TableHead className="text-right">Warnings</TableHead>
						{showFileCount && (
							<TableHead className="text-right">Files</TableHead>
						)}
					</TableRow>
				</TableHeader>
				<TableBody>
					{stores.map((store, index) => {
						const failedRows = store.failedRows ?? 0;
						const warningRows = store.warningRows ?? 0;

						return (
							<TableRow
								key={`${store.storeId ?? "store"}-${store.storeIdentifier ?? "id"}-${index}`}
							>
								<TableCell>
									<div className="font-medium">
										{store.storeName ?? "Unknown store"}
									</div>
									<div className="text-xs text-muted-foreground font-mono">
										{store.storeId ?? "-"}
									</div>
									{store.storeCity && (
										<div className="text-xs text-muted-foreground">
											{store.storeCity}
										</div>
									)}
								</TableCell>
								<TableCell>
									<span className="font-mono text-sm">
										{store.storeIdentifier ?? "-"}
									</span>
								</TableCell>
								<TableCell className="text-right">
									{formatCount(store.rowCount)}
								</TableCell>
								<TableCell className="text-right">
									{formatCount(store.persistedCount)}
								</TableCell>
								<TableCell className="text-right">
									{formatCount(store.priceChanges)}
								</TableCell>
								<TableCell
									className={`text-right ${failedRows > 0 ? "text-destructive" : ""}`}
								>
									{formatCount(store.failedRows)}
								</TableCell>
								<TableCell
									className={`text-right ${warningRows > 0 ? "text-amber-600" : ""}`}
								>
									{formatCount(store.warningRows)}
								</TableCell>
								{showFileCount && (
									<TableCell className="text-right">
										{formatCount(store.fileCount)}
									</TableCell>
								)}
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}
