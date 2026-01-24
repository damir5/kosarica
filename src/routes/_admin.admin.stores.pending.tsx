import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, FileText, Store } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BulkActionsBar } from "@/components/admin/stores/BulkActionsBar";
import { PendingStoreQueue } from "@/components/admin/stores/PendingStoreQueue";
import {
	type PendingStoreSortOption,
	PendingStoresFilters,
} from "@/components/admin/stores/PendingStoresFilters";
import { StoreApprovalModal } from "@/components/admin/stores/StoreApprovalModal";
import { StoreMergeModal } from "@/components/admin/stores/StoreMergeModal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/stores/pending")({
	component: PendingStoresPage,
});

// Type imported from PendingStoreQueue
type PendingStore = {
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

function PendingStoresPage() {
	const queryClient = useQueryClient();

	// Modal state
	const [approvalStore, setApprovalStore] = useState<PendingStore | null>(null);
	const [mergeStore, setMergeStore] = useState<PendingStore | null>(null);
	const [rejectingStoreId, setRejectingStoreId] = useState<string | null>(null);
	const [approvalError, setApprovalError] = useState<string | null>(null);

	// Filter and sort state
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedChain, setSelectedChain] = useState("all");
	const [sortBy, setSortBy] = useState<PendingStoreSortOption>("newest");
	const [currentPage, setCurrentPage] = useState(1);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	// Query pending stores
	const { data, isLoading, error } = useQuery(
		orpc.admin.stores.getPending.queryOptions({
			input: {},
		}),
	);

	// Approve mutation
	const approveMutation = useMutation({
		mutationFn: async ({
			storeId,
			expectedUpdatedAt,
			approvalNotes,
		}: {
			storeId: string;
			expectedUpdatedAt: string;
			approvalNotes?: string;
		}) => {
			return orpc.admin.stores.approve.call({
				storeId,
				expectedUpdatedAt,
				approvalNotes,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "stores"] });
			setApprovalStore(null);
			setApprovalError(null);
		},
		onError: (err) => {
			setApprovalError(err instanceof Error ? err.message : "Approval failed");
		},
	});

	// Merge mutation
	const mergeMutation = useMutation({
		mutationFn: async ({
			sourceStoreId,
			sourceExpectedUpdatedAt,
			targetStoreId,
			targetExpectedUpdatedAt,
		}: {
			sourceStoreId: string;
			sourceExpectedUpdatedAt: string;
			targetStoreId: string;
			targetExpectedUpdatedAt: string;
		}) => {
			return orpc.admin.stores.merge.call({
				sourceStoreId,
				sourceExpectedUpdatedAt,
				targetStoreId,
				targetExpectedUpdatedAt,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "stores"] });
			setMergeStore(null);
		},
	});

	// Reject mutation
	const rejectMutation = useMutation({
		mutationFn: async (storeId: string) => {
			// Find the store to get its actual updatedAt value for optimistic locking
			const store = allStores.find((s) => s.id === storeId);
			return orpc.admin.stores.reject.call({
				storeId,
				expectedUpdatedAt:
					store?.updatedAt?.toISOString() ?? new Date().toISOString(),
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "stores"] });
			setRejectingStoreId(null);
		},
	});

	// Bulk approve mutation
	const bulkApproveMutation = useMutation({
		mutationFn: async ({
			storeIds,
			approvalNotes,
		}: {
			storeIds: string[];
			approvalNotes?: string;
		}) => {
			return orpc.admin.stores.bulkApprove.call({
				storeIds,
				approvalNotes,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "stores"] });
			setSelectedIds(new Set());
		},
	});

	// Bulk reject mutation
	const bulkRejectMutation = useMutation({
		mutationFn: async ({
			storeIds,
			reason,
		}: {
			storeIds: string[];
			reason?: string;
		}) => {
			return orpc.admin.stores.bulkReject.call({
				storeIds,
				reason,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "stores"] });
			setSelectedIds(new Set());
		},
	});

	// Process stores: filter, sort, paginate
	const allStores = (data?.stores ?? []) as PendingStore[];

	const processedStores = useMemo(() => {
		let result = [...allStores];

		// Filter by search query
		if (searchQuery) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(store) =>
					store.name.toLowerCase().includes(query) ||
					(store.address?.toLowerCase().includes(query) ?? false) ||
					(store.city?.toLowerCase().includes(query) ?? false) ||
					(store.postalCode?.toLowerCase().includes(query) ?? false),
			);
		}

		// Filter by chain
		if (selectedChain !== "all") {
			result = result.filter((store) => store.chainSlug === selectedChain);
		}

		// Sort
		result = result.sort((a, b) => {
			switch (sortBy) {
				case "newest":
					return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
				case "oldest":
					return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
				case "name_asc":
					return a.name.localeCompare(b.name);
				case "name_desc":
					return b.name.localeCompare(a.name);
				case "chain_asc":
					return (
						a.chainSlug.localeCompare(b.chainSlug) ||
						a.name.localeCompare(b.name)
					);
				default:
					return 0;
			}
		});

		return result;
	}, [allStores, searchQuery, selectedChain, sortBy]);

	// Pagination
	const ITEMS_PER_PAGE = 10;
	const totalPages = Math.max(
		1,
		Math.ceil(processedStores.length / ITEMS_PER_PAGE),
	);
	const paginatedStores = processedStores.slice(
		(currentPage - 1) * ITEMS_PER_PAGE,
		currentPage * ITEMS_PER_PAGE,
	);

	// Reset to page 1 when filters change
	useEffect(() => {
		setCurrentPage(1);
	}, []);

	const hasActiveFilters = searchQuery !== "" || selectedChain !== "all";

	const handleClearFilters = () => {
		setSearchQuery("");
		setSelectedChain("all");
		setSortBy("newest");
		setCurrentPage(1);
		setSelectedIds(new Set());
	};

	const handlePageChange = (page: number) => {
		setCurrentPage(page);
		setSelectedIds(new Set()); // Clear selection when changing pages
	};

	return (
		<>
			{/* Header */}
			<div className="border-border border-b bg-card">
				<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
					<div className="flex items-center gap-3">
						<AlertCircle className="h-8 w-8 text-amber-500" />
						<div>
							<div className="flex items-center gap-2">
								<h1 className="font-semibold text-2xl text-foreground">
									Pending Stores
								</h1>
								<Badge
									variant="secondary"
									className="text-amber-600 border-amber-300"
								>
									Action Required
								</Badge>
							</div>
							<p className="mt-1 text-muted-foreground text-sm">
								Review and approve new stores detected from data imports
							</p>
						</div>
					</div>
				</div>
			</div>

			{/* Main Content */}
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
				{/* Error State */}
				{error && (
					<Card className="border-destructive/50 bg-destructive/10 mb-6">
						<CardContent className="flex items-center gap-3 py-6">
							<AlertCircle className="h-5 w-5 text-destructive" />
							<div>
								<p className="font-medium text-destructive">
									Failed to load pending stores
								</p>
								<p className="text-sm text-muted-foreground">
									{error instanceof Error
										? error.message
										: "An unexpected error occurred"}
								</p>
							</div>
						</CardContent>
					</Card>
				)}

				{!error && (
					<div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
						{/* Filters Sidebar */}
						<div className="lg:col-span-1">
							<Card className="sticky top-4">
								<CardContent className="pt-6">
									<PendingStoresFilters
										searchQuery={searchQuery}
										onSearchChange={setSearchQuery}
										selectedChain={selectedChain}
										onChainChange={setSelectedChain}
										sortBy={sortBy}
										onSortChange={setSortBy}
										storeCount={processedStores.length}
										hasActiveFilters={hasActiveFilters}
										onClearFilters={handleClearFilters}
									/>
								</CardContent>
							</Card>
						</div>

						{/* Main Queue */}
						<div className="lg:col-span-3">
							{/* Bulk Actions Bar */}
							{selectedIds.size > 0 && (
								<div className="mb-4">
									<BulkActionsBar
										selectedCount={selectedIds.size}
										onBulkApprove={async (notes) => {
											await bulkApproveMutation.mutateAsync({
												storeIds: Array.from(selectedIds),
												approvalNotes: notes,
											});
										}}
										onBulkReject={async (reason) => {
											await bulkRejectMutation.mutateAsync({
												storeIds: Array.from(selectedIds),
												reason,
											});
										}}
										onClearSelection={() => setSelectedIds(new Set())}
										isApproving={bulkApproveMutation.isPending}
										isRejecting={bulkRejectMutation.isPending}
									/>
								</div>
							)}

							<PendingStoreQueue
								stores={paginatedStores}
								selectedIds={selectedIds}
								onSelectionChange={setSelectedIds}
								isLoading={isLoading}
								onApprove={(store) => setApprovalStore(store)}
								onMerge={(store) => setMergeStore(store)}
								onReject={(storeId) => {
									setRejectingStoreId(storeId);
									rejectMutation.mutate(storeId);
								}}
								rejectingStoreId={rejectingStoreId}
								currentPage={currentPage}
								totalPages={totalPages}
								onPageChange={handlePageChange}
							/>

							{/* Help Section */}
							{!isLoading && processedStores.length > 0 && (
								<Card className="mt-6 bg-muted/50">
									<CardHeader>
										<CardTitle className="text-base flex items-center gap-2">
											<FileText className="h-4 w-4" />
											Understanding Store Approval
										</CardTitle>
									</CardHeader>
									<CardContent className="text-sm text-muted-foreground space-y-3">
										<p>
											<strong className="text-foreground">
												Approve as New Price Source:
											</strong>{" "}
											Creates a new virtual store that represents a distinct set
											of prices (e.g., specific region, web-only, or promotional
											pricing).
										</p>
										<p>
											<strong className="text-foreground">
												Merge into Existing Source:
											</strong>{" "}
											Maps this store to an existing price source when the data
											actually belongs to an already-tracked price list.
										</p>
										<p>
											<strong className="text-foreground">
												Reject &amp; Block:
											</strong>{" "}
											Removes this store from the system. Use this for invalid,
											duplicate, or garbage data that should not be tracked.
										</p>
									</CardContent>
								</Card>
							)}

							{/* Empty State (when no results after filtering) */}
							{!isLoading &&
								processedStores.length === 0 &&
								allStores.length > 0 && (
									<Card>
										<CardContent className="flex flex-col items-center justify-center py-12">
											<Store className="h-12 w-12 text-muted-foreground/50 mb-4" />
											<h3 className="font-medium text-lg text-foreground mb-1">
												No stores match your filters
											</h3>
											<p className="text-muted-foreground text-sm text-center max-w-sm">
												Try adjusting your search or filter settings to find
												what you're looking for.
											</p>
										</CardContent>
									</Card>
								)}
						</div>
					</div>
				)}
			</div>

			{/* Approval Modal */}
			<StoreApprovalModal
				store={approvalStore}
				open={!!approvalStore}
				onOpenChange={(open) => {
					if (!open) {
						setApprovalStore(null);
						setApprovalError(null);
					}
				}}
				onConfirm={async (notes) => {
					setApprovalError(null);
					if (approvalStore) {
						if (!approvalStore.updatedAt) {
							setApprovalError(
								"Cannot approve store: missing update timestamp. Please refresh and try again.",
							);
							return;
						}
						await approveMutation.mutateAsync({
							storeId: approvalStore.id,
							expectedUpdatedAt: approvalStore.updatedAt.toISOString(),
							approvalNotes: notes,
						});
					}
				}}
				isLoading={approveMutation.isPending}
				error={approvalError}
				onClearError={() => setApprovalError(null)}
			/>

			{/* Merge Modal */}
			<StoreMergeModal
				store={mergeStore}
				open={!!mergeStore}
				onOpenChange={(open) => !open && setMergeStore(null)}
				onConfirm={async (targetStoreId, targetStore) => {
					if (mergeStore) {
						if (!mergeStore.updatedAt || !targetStore?.updatedAt) {
							setApprovalError(
								"Cannot merge stores: missing update timestamp. Please refresh and try again.",
							);
							return;
						}
						await mergeMutation.mutateAsync({
							sourceStoreId: mergeStore.id,
							sourceExpectedUpdatedAt: mergeStore.updatedAt.toISOString(),
							targetStoreId,
							targetExpectedUpdatedAt: targetStore.updatedAt.toISOString(),
						});
					}
				}}
				isLoading={mergeMutation.isPending}
			/>
		</>
	);
}
