import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/orpc";

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

interface MatchReviewCardProps {
	item: QueueItem;
	isSelected: boolean;
	onSelect: () => void;
	onApprove: () => void;
}

const MATCH_TYPE_COLORS: Record<string, string> = {
	ai: "bg-purple-500/10 text-purple-700 border-purple-200",
	barcode: "bg-green-500/10 text-green-700 border-green-200",
	trgm: "bg-blue-500/10 text-blue-700 border-blue-200",
	heuristic: "bg-gray-500/10 text-gray-700 border-gray-200",
};

function getSimilarityPercent(similarity: string): number {
	return Math.round(parseFloat(similarity) * 100);
}

function getMatchConfidenceBadge(similarity: string, _matchType: string) {
	const percent = getSimilarityPercent(similarity);

	if (percent >= 95) {
		return (
			<Badge className="bg-green-500 text-white">
				High Confidence ({percent}%)
			</Badge>
		);
	}
	if (percent >= 80) {
		return (
			<Badge className="bg-yellow-500 text-white">Medium ({percent}%)</Badge>
		);
	}
	return <Badge variant="outline">Low ({percent}%)</Badge>;
}

export function MatchReviewCard({
	item,
	isSelected,
	onSelect,
	onApprove,
}: MatchReviewCardProps) {
	const [selectedProductId, setSelectedProductId] = useState<string | null>(
		item.linkedProductId || (item.candidates[0]?.candidateProductId ?? null),
	);
	const [showProductSearch, setShowProductSearch] = useState(false);
	const [notes, setNotes] = useState("");

	const approveMutation = useMutation({
		mutationFn: async (productId: string) => {
			return await orpc.admin.products.approveMatch.call({
				queueId: item.id,
				productId,
				notes: notes || undefined,
				version: item.version,
			});
		},
		onSuccess: () => {
			onApprove();
		},
	});

	const rejectMutation = useMutation({
		mutationFn: async (productId: string | null) => {
			return await orpc.admin.products.rejectMatch.call({
				queueId: item.id,
				productId: productId ?? undefined,
				reason: "rejected",
				version: item.version,
			});
		},
		onSuccess: () => {
			onApprove();
		},
	});

	const resolveSuspiciousMutation = useMutation({
		mutationFn: async (productId: string) => {
			return await orpc.admin.products.resolveSuspicious.call({
				queueId: item.id,
				productId,
				notes: notes || "Resolved suspicious barcode match",
				version: item.version,
			});
		},
		onSuccess: () => {
			onApprove();
		},
	});

	const handleApprove = () => {
		if (!selectedProductId) return;

		// Check if this is a suspicious barcode
		const hasSuspiciousFlag = item.candidates.some((c) =>
			c.flags?.includes("suspicious_barcode"),
		);
		if (hasSuspiciousFlag) {
			resolveSuspiciousMutation.mutate(selectedProductId);
		} else {
			approveMutation.mutate(selectedProductId);
		}
	};

	const handleReject = (productId: string | null) => {
		rejectMutation.mutate(productId);
	};

	const handleRejectAll = () => {
		handleReject(null);
	};

	const retailerItem = item.retailer_item;
	const hasSuspiciousFlag = item.candidates.some((c) =>
		c.flags?.includes("suspicious"),
	);

	return (
		<Card className={isSelected ? "ring-2 ring-primary" : ""}>
			<CardHeader>
				<div className="flex items-start gap-3">
					<Checkbox checked={isSelected} onChange={onSelect} className="mt-1" />
					<div className="flex-1 space-y-2">
						<div className="flex items-center justify-between">
							<CardTitle className="text-lg">{retailerItem.name}</CardTitle>
							{hasSuspiciousFlag && (
								<Badge
									variant="destructive"
									className="flex items-center gap-1"
								>
									<AlertTriangle className="h-3 w-3" />
									Suspicious
								</Badge>
							)}
						</div>
						<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
							<span className="font-medium">{retailerItem.chainName}</span>
							{retailerItem.barcode && (
								<>
									<span>•</span>
									<span>Barcode: {retailerItem.barcode}</span>
								</>
							)}
							{retailerItem.brand && (
								<>
									<span>•</span>
									<span>{retailerItem.brand}</span>
								</>
							)}
							{retailerItem.unit && (
								<>
									<span>•</span>
									<span>
										{retailerItem.unitQuantity} {retailerItem.unit}
									</span>
								</>
							)}
						</div>
						{item.candidates.length > 0 && (
							<div className="flex flex-wrap gap-2">
								{item.candidates.slice(0, 3).map((candidate) => (
									<Badge
										key={candidate.candidateProductId}
										variant="outline"
										className={MATCH_TYPE_COLORS[candidate.matchType] ?? ""}
									>
										{candidate.matchType} (
										{getSimilarityPercent(candidate.similarity)}%)
									</Badge>
								))}
							</div>
						)}
					</div>
				</div>
			</CardHeader>
			<CardContent>
				{item.candidates.length === 0 ? (
					<div className="space-y-4">
						<p className="text-muted-foreground">
							No product candidates found. Create a new product or search
							manually.
						</p>
						<div className="flex gap-2">
							<Button
								onClick={() => setShowProductSearch(true)}
								variant="outline"
							>
								Search Products
							</Button>
							<Button onClick={handleRejectAll} variant="destructive">
								No Match Exists
							</Button>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						{/* Candidates List */}
						<div className="space-y-3">
							{item.candidates.map((candidate) => (
								<div
									key={candidate.candidateProductId}
									className={`border rounded-lg p-4 cursor-pointer transition-colors ${
										selectedProductId === candidate.candidateProductId
											? "border-primary bg-primary/5"
											: "border-border hover:border-primary/50"
									}`}
									onClick={() =>
										setSelectedProductId(candidate.candidateProductId)
									}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											setSelectedProductId(candidate.candidateProductId);
										}
									}}
									role="button"
									tabIndex={0}
								>
									<div className="flex items-start gap-4">
										{/* Product Image */}
										{candidate.product.imageUrl ? (
											<img
												src={candidate.product.imageUrl}
												alt={candidate.product.name}
												className="w-16 h-16 object-cover rounded"
											/>
										) : (
											<div className="w-16 h-16 bg-muted rounded flex items-center justify-center text-muted-foreground">
												No image
											</div>
										)}

										<div className="flex-1 space-y-2">
											<div className="flex items-center justify-between">
												<h4 className="font-medium">
													{candidate.product.name}
												</h4>
												{selectedProductId === candidate.candidateProductId && (
													<div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
														<Check className="h-3 w-3 text-primary-foreground" />
													</div>
												)}
											</div>

											<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
												{candidate.product.brand && (
													<span>{candidate.product.brand}</span>
												)}
												{candidate.product.category && (
													<>
														<span>•</span>
														<span>{candidate.product.category}</span>
													</>
												)}
											</div>

											<div className="flex items-center gap-2">
												<Badge
													variant="outline"
													className={
														MATCH_TYPE_COLORS[candidate.matchType] ?? ""
													}
												>
													{candidate.matchType}
												</Badge>
												{getMatchConfidenceBadge(
													candidate.similarity,
													candidate.matchType,
												)}
												{candidate.flags && (
													<Badge variant="destructive">{candidate.flags}</Badge>
												)}
											</div>
										</div>

										{/* Quick Reject for this candidate */}
										<Button
											size="sm"
											variant="ghost"
											onClick={(e) => {
												e.stopPropagation();
												handleReject(candidate.candidateProductId);
											}}
										>
											<X className="h-4 w-4" />
										</Button>
									</div>
								</div>
							))}
						</div>

						{/* Notes */}
						<Textarea
							placeholder="Add review notes (optional)..."
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							rows={2}
						/>

						{/* Actions */}
						<div className="flex flex-wrap gap-2">
							<Button
								onClick={handleApprove}
								disabled={!selectedProductId || approveMutation.isPending}
								className="flex-1"
							>
								<Check className="h-4 w-4 mr-2" />
								{hasSuspiciousFlag ? "Resolve & Link" : "Approve Match"}
							</Button>
							<Button
								onClick={() => handleReject(selectedProductId)}
								disabled={!selectedProductId || rejectMutation.isPending}
								variant="outline"
							>
								Reject Candidate
							</Button>
							<Button
								onClick={handleRejectAll}
								disabled={rejectMutation.isPending}
								variant="outline"
							>
								No Match
							</Button>
							<Button
								onClick={() => setShowProductSearch(true)}
								variant="outline"
								className="flex items-center gap-1"
							>
								Search Other Product
								<ChevronRight className="h-4 w-4" />
							</Button>
						</div>
					</div>
				)}

				{/* Product Search Modal */}
				{showProductSearch && (
					<ProductSearchModal
						retailerItemName={retailerItem.name}
						onSelect={(productId) => {
							setSelectedProductId(productId);
							setShowProductSearch(false);
						}}
						onClose={() => setShowProductSearch(false)}
					/>
				)}
			</CardContent>
		</Card>
	);
}

// Product Search Modal Component
function ProductSearchModal({
	retailerItemName,
	onSelect,
	onClose,
}: {
	retailerItemName: string;
	onSelect: (productId: string) => void;
	onClose: () => void;
}) {
	const [query, setQuery] = useState(retailerItemName);
	const [results, setResults] = useState<
		Array<{
			id: string;
			name: string;
			brand: string | null;
			category: string | null;
		}>
	>([]);
	const [isLoading, setIsLoading] = useState(false);

	const searchProducts = async (searchQuery: string) => {
		if (!searchQuery || searchQuery.length < 3) return;
		setIsLoading(true);
		try {
			const response = await orpc.admin.products.searchProducts.call({
				query: searchQuery,
				limit: 20,
			});
			setResults(response as typeof results);
		} catch (error) {
			console.error("Search failed:", error);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
			<div className="bg-background rounded-lg shadow-lg max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
				<div className="p-4 border-b">
					<h3 className="text-lg font-semibold">Search Products</h3>
					<input
						type="text"
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							searchProducts(e.target.value);
						}}
						placeholder="Search by product name..."
						className="w-full mt-2 px-3 py-2 border rounded-md"
					/>
				</div>
				<div className="flex-1 overflow-y-auto p-4 space-y-2">
					{isLoading ? (
						<div className="text-center text-muted-foreground">
							Searching...
						</div>
					) : results.length === 0 ? (
						<div className="text-center text-muted-foreground">
							{query.length < 3
								? "Enter at least 3 characters to search"
								: "No products found"}
						</div>
					) : (
						results.map((product) => (
							<div
								key={product.id}
								className="border rounded-lg p-3 hover:border-primary cursor-pointer"
								onClick={() => onSelect(product.id)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										onSelect(product.id);
									}
								}}
								role="button"
								tabIndex={0}
							>
								<div className="font-medium">{product.name}</div>
								<div className="text-sm text-muted-foreground">
									{product.brand && <span>{product.brand}</span>}
									{product.category && <span> • {product.category}</span>}
								</div>
							</div>
						))
					)}
				</div>
				<div className="p-4 border-t flex justify-end">
					<Button onClick={onClose} variant="outline">
						Close
					</Button>
				</div>
			</div>
		</div>
	);
}
