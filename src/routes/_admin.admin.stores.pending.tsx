import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, Building2, FileText, Store } from "lucide-react";
import { useState } from "react";
import { PendingStoreCard } from "@/components/admin/stores/PendingStoreCard";
import { StoreApprovalModal } from "@/components/admin/stores/StoreApprovalModal";
import { StoreMergeModal } from "@/components/admin/stores/StoreMergeModal";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/stores/pending")({
	component: PendingStoresPage,
});

// Type inferred from the API response
type StoreFromAPI = {
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
	const [approvalStore, setApprovalStore] = useState<StoreFromAPI | null>(null);
	const [mergeStore, setMergeStore] = useState<StoreFromAPI | null>(null);
	const [rejectingStoreId, setRejectingStoreId] = useState<string | null>(null);

	// Query pending stores
	const { data, isLoading, error } = useQuery(
		orpc.admin.stores.getPending.queryOptions({
			input: {},
		}),
	);

	// Approve mutation
	const approveMutation = useMutation({
		mutationFn: async (storeId: string) => {
			return orpc.admin.stores.approve.call({ storeId });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "stores"] });
			setApprovalStore(null);
		},
	});

	// Merge mutation
	const mergeMutation = useMutation({
		mutationFn: async ({
			sourceStoreId,
			targetStoreId,
		}: {
			sourceStoreId: string;
			targetStoreId: string;
		}) => {
			return orpc.admin.stores.merge.call({ sourceStoreId, targetStoreId });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "stores"] });
			setMergeStore(null);
		},
	});

	// Reject mutation
	const rejectMutation = useMutation({
		mutationFn: async (storeId: string) => {
			return orpc.admin.stores.reject.call({ storeId });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "stores"] });
			setRejectingStoreId(null);
		},
	});

	const pendingStores = (data?.stores ?? []) as StoreFromAPI[];

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
				{/* Loading State */}
				{isLoading && (
					<div className="flex items-center justify-center py-12">
						<p className="text-muted-foreground">Loading pending stores...</p>
					</div>
				)}

				{/* Error State */}
				{error && (
					<Card className="border-destructive/50 bg-destructive/10">
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

				{/* Empty State */}
				{!isLoading && !error && pendingStores.length === 0 && (
					<Card>
						<CardContent className="flex flex-col items-center justify-center py-12">
							<Store className="h-12 w-12 text-muted-foreground/50 mb-4" />
							<h3 className="font-medium text-lg text-foreground mb-1">
								No pending stores
							</h3>
							<p className="text-muted-foreground text-sm text-center max-w-sm">
								All stores have been reviewed. New stores will appear here when
								they are detected from data imports.
							</p>
						</CardContent>
					</Card>
				)}

				{/* Pending Stores List */}
				{!isLoading && !error && pendingStores.length > 0 && (
					<div className="space-y-6">
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<Building2 className="h-5 w-5" />
									Stores Awaiting Review
								</CardTitle>
								<CardDescription>
									{pendingStores.length} store
									{pendingStores.length !== 1 ? "s" : ""} detected and awaiting
									your decision
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								{pendingStores.map((store, index) => (
									<PendingStoreCard
										key={store.id}
										index={index + 1}
										store={store}
										onApprove={() => setApprovalStore(store)}
										onMerge={() => setMergeStore(store)}
										onReject={() => {
											setRejectingStoreId(store.id);
											rejectMutation.mutate(store.id);
										}}
										isRejecting={
											rejectingStoreId === store.id && rejectMutation.isPending
										}
									/>
								))}
							</CardContent>
						</Card>

						{/* Help Section */}
						<Card className="bg-muted/50">
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
									Creates a new virtual store that represents a distinct set of
									prices (e.g., specific region, web-only, or promotional
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
					</div>
				)}
			</div>

			{/* Approval Modal */}
			<StoreApprovalModal
				store={approvalStore}
				open={!!approvalStore}
				onOpenChange={(open) => !open && setApprovalStore(null)}
				onConfirm={async () => {
					if (approvalStore) {
						await approveMutation.mutateAsync(approvalStore.id);
					}
				}}
				isLoading={approveMutation.isPending}
			/>

			{/* Merge Modal */}
			<StoreMergeModal
				store={mergeStore}
				open={!!mergeStore}
				onOpenChange={(open) => !open && setMergeStore(null)}
				onConfirm={async (targetStoreId) => {
					if (mergeStore) {
						await mergeMutation.mutateAsync({
							sourceStoreId: mergeStore.id,
							targetStoreId,
						});
					}
				}}
				isLoading={mergeMutation.isPending}
			/>
		</>
	);
}
