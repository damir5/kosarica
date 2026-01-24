import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { orpc } from "@/orpc";
import { createReactQueryHooks } from "@/orpc/react";
import { BulkActionsBar } from "./BulkActionsBar";
import { MatchReviewCard } from "./MatchReviewCard";

interface RetailerItem {
	id: string;
	name: string;
	barcode: string;
	brand: string;
	unit: string;
	unitQuantity: string;
	imageUrl: string;
	chainName: string;
	chainSlug: string;
}

interface ProductCandidate {
	candidateProductId: string;
	similarity: string;
	rank: number;
	matchType: string;
	flags: string | null;
	product: {
		id: string;
		name: string;
		brand: string | null;
		category: string | null;
		imageUrl: string | null;
	};
}

interface QueueItem {
	id: string;
	status: string;
	decision: string | null;
	linkedProductId: string | null;
	reviewNotes: string | null;
	created_at: string;
	version: number;
	retailer_item: RetailerItem;
	candidates: ProductCandidate[];
}

interface MatchReviewQueueResponse {
	items: QueueItem[];
	nextCursor: string | undefined;
	hasMore: boolean;
}

const _hooks = createReactQueryHooks(orpc);

export function MatchReviewQueue() {
	const queryClient = useQueryClient();
	const [cursor, setCursor] = useState<string>();
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	const {
		data: queueData,
		isLoading,
		refetch,
	} = useQuery({
		queryKey: ["admin", "products", "pendingMatches", cursor],
		queryFn: async () => {
			const result = await orpc.admin.products.getPendingMatches({
				limit: 20,
				cursor,
			});
			return result as MatchReviewQueueResponse;
		},
	});

	const { data: count } = useQuery({
		queryKey: ["admin", "products", "pendingMatchCount"],
		queryFn: () => orpc.admin.products.getPendingMatchCount(),
		refetchInterval: 30000, // Refresh every 30 seconds
	});

	const bulkApprove = useMutation({
		mutationFn: async (queueIds: string[]) => {
			return await orpc.admin.products.bulkApprove({ queueIds });
		},
		onSuccess: () => {
			setSelectedIds(new Set());
			queryClient.invalidateQueries({
				queryKey: ["admin", "products", "pendingMatches"],
			});
			queryClient.invalidateQueries({
				queryKey: ["admin", "products", "pendingMatchCount"],
			});
		},
	});

	const items = queueData?.items ?? [];
	const hasMore = queueData?.hasMore ?? false;
	const pendingCount = count ?? 0;

	const handleSelectAll = () => {
		if (selectedIds.size === items.length) {
			setSelectedIds(new Set());
		} else {
			setSelectedIds(new Set(items.map((item) => item.id)));
		}
	};

	const handleSelectItem = (id: string) => {
		const newSelected = new Set(selectedIds);
		if (newSelected.has(id)) {
			newSelected.delete(id);
		} else {
			newSelected.add(id);
		}
		setSelectedIds(newSelected);
	};

	const handlePrevious = () => {
		// Note: True backward pagination would require tracking previous cursors
		// For now, we'll just clear to go back to start
		setCursor(undefined);
	};

	const handleNext = () => {
		if (queueData?.nextCursor) {
			setCursor(queueData.nextCursor);
		}
	};

	const handleBulkApprove = async () => {
		if (selectedIds.size === 0) return;
		await bulkApprove.mutateAsync(Array.from(selectedIds));
	};

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-2xl font-bold">Product Match Review</h2>
					<p className="text-muted-foreground">
						{pendingCount} item{pendingCount !== 1 ? "s" : ""} pending review
					</p>
				</div>
				<Button onClick={() => refetch()} variant="outline" size="sm">
					<RefreshCw className="h-4 w-4 mr-2" />
					Refresh
				</Button>
			</div>

			{/* Stats Cards */}
			<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium">
							Pending Review
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{pendingCount}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium">AI Matches</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{
								items.filter((item) =>
									item.candidates.some((c) => c.matchType === "ai"),
								).length
							}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium">
							Barcode Matches
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{
								items.filter((item) =>
									item.candidates.some((c) => c.matchType === "barcode"),
								).length
							}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium">Suspicious</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{
								items.filter((item) =>
									item.candidates.some((c) => c.flags !== null),
								).length
							}
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Bulk Actions */}
			{selectedIds.size > 0 && (
				<BulkActionsBar
					selectedCount={selectedIds.size}
					onApprove={handleBulkApprove}
					onClear={() => setSelectedIds(new Set())}
					isLoading={bulkApprove.isPending}
				/>
			)}

			{/* Queue Items */}
			{isLoading ? (
				<div className="space-y-4">
					{[1, 2, 3].map((i) => (
						<Card key={i}>
							<CardHeader>
								<Skeleton className="h-5 w-3/4" />
								<Skeleton className="h-4 w-1/2 mt-2" />
							</CardHeader>
							<CardContent>
								<Skeleton className="h-20 w-full" />
							</CardContent>
						</Card>
					))}
				</div>
			) : items.length === 0 ? (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground">
						No items pending review
					</CardContent>
				</Card>
			) : (
				<>
					{/* Select All Checkbox */}
					<div className="flex items-center gap-2 mb-4">
						<input
							id="select-all"
							type="checkbox"
							checked={selectedIds.size === items.length}
							onChange={handleSelectAll}
							className="h-4 w-4"
						/>
						<label htmlFor="select-all" className="text-sm">
							Select All ({items.length})
						</label>
					</div>

					{/* Items List */}
					<div className="space-y-4">
						{items.map((item) => (
							<MatchReviewCard
								key={item.id}
								item={item}
								isSelected={selectedIds.has(item.id)}
								onSelect={() => handleSelectItem(item.id)}
								onApprove={() => {
									queryClient.invalidateQueries({
										queryKey: ["admin", "products", "pendingMatches"],
									});
									queryClient.invalidateQueries({
										queryKey: ["admin", "products", "pendingMatchCount"],
									});
								}}
							/>
						))}
					</div>

					{/* Pagination */}
					<div className="flex items-center justify-between mt-6">
						<Button
							onClick={handlePrevious}
							variant="outline"
							disabled={!cursor}
						>
							<ChevronLeft className="h-4 w-4 mr-2" />
							Previous
						</Button>
						<span className="text-sm text-muted-foreground">
							Showing {items.length} items
							{hasMore && " (more available)"}
						</span>
						<Button onClick={handleNext} variant="outline" disabled={!hasMore}>
							Next
							<ChevronRight className="h-4 w-4 ml-2" />
						</Button>
					</div>
				</>
			)}
		</div>
	);
}
