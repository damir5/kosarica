import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PendingStoreCard } from "./PendingStoreCard";
import type { PendingStoreSortOption } from "./PendingStoresFilters";

export type PendingStore = {
	id: string;
	chainSlug: string;
	name: string;
	address: string | null;
	city: string | null;
	postalCode: string | null;
	latitude: string | null;
	longitude: string | null;
	isVirtual: boolean | null;
	priceSourceStoreId: string | null;
	status: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};

interface PendingStoreQueueProps {
	stores: PendingStore[];
	selectedIds: Set<string>;
	onSelectionChange: (selectedIds: Set<string>) => void;
	isLoading: boolean;
	onApprove: (store: PendingStore) => void;
	onMerge: (store: PendingStore) => void;
	onReject: (storeId: string) => void;
	rejectingStoreId: string | null;
	currentPage: number;
	totalPages: number;
	onPageChange: (page: number) => void;
}

const ITEMS_PER_PAGE = 10;

export function PendingStoreQueue({
	stores,
	selectedIds,
	onSelectionChange,
	isLoading,
	onApprove,
	onMerge,
	onReject,
	rejectingStoreId,
	currentPage,
	totalPages,
	onPageChange,
}: PendingStoreQueueProps) {
	const allSelected =
		stores.length > 0 && stores.every((store) => selectedIds.has(store.id));
	const someSelected =
		stores.length > 0 && stores.some((store) => selectedIds.has(store.id));

	const handleToggleSelect = (storeId: string) => {
		const newSelected = new Set(selectedIds);
		if (newSelected.has(storeId)) {
			newSelected.delete(storeId);
		} else {
			newSelected.add(storeId);
		}
		onSelectionChange(newSelected);
	};

	const handleToggleSelectAll = () => {
		if (allSelected) {
			// Deselect all visible stores
			const newSelected = new Set(selectedIds);
			for (const store of stores) {
				newSelected.delete(store.id);
			}
			onSelectionChange(newSelected);
		} else {
			// Select all visible stores
			const newSelected = new Set(selectedIds);
			for (const store of stores) {
				newSelected.add(store.id);
			}
			onSelectionChange(newSelected);
		}
	};

	if (isLoading) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-12">
					<div className="flex flex-col items-center gap-3">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						<p className="text-sm text-muted-foreground">Loading stores...</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	if (stores.length === 0) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12">
					<div className="text-center max-w-sm">
						<Check className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
						<h3 className="font-medium text-lg text-foreground mb-1">
							No pending stores
						</h3>
						<p className="text-sm text-muted-foreground">
							All stores have been reviewed. New stores will appear here when they
							are detected from data imports.
						</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			{/* Select All Bar */}
			<Card className="border-l-4 border-l-amber-500">
				<CardContent className="py-3">
					<div className="flex items-center justify-between">
						<label className="flex items-center gap-3 cursor-pointer">
							<input
								type="checkbox"
								checked={allSelected}
								ref={(input) => {
									if (input) {
										input.indeterminate = someSelected && !allSelected;
									}
								}}
								onChange={handleToggleSelectAll}
								className="h-4 w-4 rounded border-border text-amber-600 focus:ring-2 focus:ring-amber-500 focus:ring-offset-0"
							/>
							<span className="text-sm font-medium">
								{allSelected
									? "All selected"
									: someSelected
										? `${selectedIds.size} selected`
										: "Select all on this page"}
							</span>
						</label>
						{someSelected && (
							<span className="text-xs text-muted-foreground">
								{selectedIds.size} store{selectedIds.size !== 1 ? "s" : ""} selected
							</span>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Store List */}
			<div className="space-y-3">
				{stores.map((store, index) => (
					<div
						key={store.id}
						className={`relative transition-all ${
							selectedIds.has(store.id)
								? "ring-2 ring-amber-500 ring-offset-2 rounded-lg"
								: ""
						}`}
					>
						{/* Selection Checkbox */}
						<div className="absolute left-3 top-3 z-10">
							<input
								type="checkbox"
								checked={selectedIds.has(store.id)}
								onChange={() => handleToggleSelect(store.id)}
								className="h-4 w-4 rounded border-border text-amber-600 focus:ring-2 focus:ring-amber-500 focus:ring-offset-0 cursor-pointer"
							/>
						</div>

						{/* Store Card with padding for checkbox */}
						<div className="pl-10">
							<PendingStoreCard
								key={store.id}
								index={(currentPage - 1) * ITEMS_PER_PAGE + index + 1}
								store={store}
								onApprove={() => onApprove(store)}
								onMerge={() => onMerge(store)}
								onReject={() => onReject(store.id)}
								isRejecting={rejectingStoreId === store.id}
							/>
						</div>
					</div>
				))}
			</div>

			{/* Pagination */}
			{totalPages > 1 && (
				<Card>
					<CardContent className="py-3">
						<div className="flex items-center justify-between">
							<p className="text-xs text-muted-foreground">
								Page {currentPage} of {totalPages}
							</p>
							<div className="flex items-center gap-1">
								<Button
									variant="outline"
									size="sm"
									onClick={() => onPageChange(currentPage - 1)}
									disabled={currentPage === 1}
									className="h-8"
								>
									<ChevronLeft className="h-4 w-4" />
									Previous
								</Button>
								<div className="flex items-center gap-1">
									{Array.from({ length: totalPages }, (_, i) => i + 1).map(
										(page) => {
											// Show first, last, current, and adjacent pages
											const showPage =
												page === 1 ||
												page === totalPages ||
												Math.abs(page - currentPage) <= 1;

											if (!showPage) {
												// Show ellipsis for hidden pages
												if (
													page === 2 ||
													page === totalPages - 1 ||
													(page === currentPage - 2 && page > 1) ||
													(page === currentPage + 2 && page < totalPages)
												) {
													return (
														<span
															key={page}
															className="px-2 text-xs text-muted-foreground"
														>
															...
														</span>
													);
												}
												return null;
											}

											return (
												<Button
													key={page}
													variant={currentPage === page ? "default" : "outline"}
													size="sm"
													onClick={() => onPageChange(page)}
													className="h-8 w-8 p-0"
												>
													{page}
												</Button>
											);
										},
									)}
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={() => onPageChange(currentPage + 1)}
									disabled={currentPage === totalPages}
									className="h-8"
								>
									Next
									<ChevronRight className="h-4 w-4" />
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}

/**
 * Sort stores based on the selected sort option
 */
export function sortStores(
	stores: PendingStore[],
	sortBy: PendingStoreSortOption,
): PendingStore[] {
	const sorted = [...stores];

	switch (sortBy) {
		case "newest":
			return sorted.sort(
				(a, b) =>
					(b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
			);
		case "oldest":
			return sorted.sort(
				(a, b) =>
					(a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
			);
		case "name_asc":
			return sorted.sort((a, b) => a.name.localeCompare(b.name));
		case "name_desc":
			return sorted.sort((a, b) => b.name.localeCompare(a.name));
		case "chain_asc":
			return sorted.sort((a, b) =>
				a.chainSlug.localeCompare(b.chainSlug) ||
				a.name.localeCompare(b.name),
			);
		default:
			return sorted;
	}
}

/**
 * Filter stores based on search query and chain selection
 */
export function filterStores(
	stores: PendingStore[],
	searchQuery: string,
	chainSlug: string,
): PendingStore[] {
	return stores.filter((store) => {
		// Chain filter
		if (chainSlug !== "all" && store.chainSlug !== chainSlug) {
			return false;
		}

		// Search filter
		if (searchQuery) {
			const query = searchQuery.toLowerCase();
			return (
				store.name.toLowerCase().includes(query) ||
				(store.address?.toLowerCase().includes(query) ?? false) ||
				(store.city?.toLowerCase().includes(query) ?? false) ||
				(store.postalCode?.toLowerCase().includes(query) ?? false)
			);
		}

		return true;
	});
}

/**
 * Paginate stores
 */
export function paginateStores(
	stores: PendingStore[],
	page: number,
	pageSize: number = ITEMS_PER_PAGE,
): { stores: PendingStore[]; totalPages: number } {
	const totalPages = Math.ceil(stores.length / pageSize);
	const startIndex = (page - 1) * pageSize;
	const endIndex = startIndex + pageSize;

	return {
		stores: stores.slice(startIndex, endIndex),
		totalPages,
	};
}
