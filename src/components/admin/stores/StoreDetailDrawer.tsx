import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	AlertTriangle,
	ArrowRight,
	Brain,
	Calendar,
	Check,
	FileText,
	Loader2,
	Lock,
	MapPin,
	RefreshCw,
	Sparkles,
	Store,
	X,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/orpc/client";
import type { EnrichmentTask } from "./EnrichmentTaskCard";
import { StoreEnrichmentSection } from "./StoreEnrichmentSection";
import { StoreLocationMap } from "./StoreLocationMap";
import { StoreStatusBadge } from "./StoreStatusBadge";
import { VerifyLocationModal } from "./VerifyLocationModal";

type StoreDetail = {
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
	approvalNotes: string | null;
	approvedBy: string | null;
	approvedAt: Date | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};

type EnrichmentTaskData = {
	id: string;
	storeId: string;
	type: "geocode" | "verify_address" | "ai_categorize";
	status: "pending" | "processing" | "completed" | "failed";
	inputData: string | null;
	outputData: string | null;
	confidence: string | null;
	verifiedBy: string | null;
	verifiedAt: Date | null;
	errorMessage: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};

type SimilarStore = {
	id: string;
	name: string;
	address: string | null;
	city: string | null;
};

type LinkedStore = {
	id: string;
	name: string;
	address: string | null;
	city: string | null;
};

interface StoreDetailDrawerProps {
	storeId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onApprove?: (
		storeId: string,
		expectedUpdatedAt: string,
		notes?: string,
	) => Promise<void>;
	onReject?: (storeId: string, expectedUpdatedAt: string) => Promise<void>;
	onForceApprove?: (
		storeId: string,
		expectedUpdatedAt: string,
		notes?: string,
		justification?: string,
	) => Promise<void>;
	onMerge?: (storeId: string) => void;
}

export function StoreDetailDrawer({
	storeId,
	open,
	onOpenChange,
	onApprove,
	onReject,
	onForceApprove,
	onMerge,
}: StoreDetailDrawerProps) {
	const queryClient = useQueryClient();
	const [approvalNotes, setApprovalNotes] = useState("");
	const [rejectReason, setRejectReason] = useState("");
	const [forceApproveJustification, setForceApproveJustification] =
		useState("");
	const [showForceApprove, setShowForceApprove] = useState(false);
	const [selectedTask, setSelectedTask] = useState<EnrichmentTask | null>(null);
	const [verifyModalOpen, setVerifyModalOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [actionInProgress, setActionInProgress] = useState<string | null>(null);
	const [isConflictError, setIsConflictError] = useState(false);

	// Fetch store detail - use any type to avoid oRPC type issues
	const { data: detailData, isLoading: isLoadingDetail } = useQuery({
		queryKey: ["admin", "stores", "getDetail", storeId],
		queryFn: async () => {
			if (!storeId) return null;
			return orpc.admin.stores.getDetail.call({ storeId }) as any;
		},
		enabled: !!storeId && open,
	});

	const store = detailData?.store as StoreDetail | undefined;
	const enrichmentTasks = (detailData?.enrichmentTasks ||
		[]) as EnrichmentTaskData[];
	const linkedPhysicalStores = (detailData?.linkedPhysicalStores ||
		[]) as LinkedStore[];
	const similarStores = (detailData?.similarStores || []) as SimilarStore[];

	// Verify enrichment mutation
	const verifyMutation = useMutation({
		mutationFn: async ({
			taskId,
			accepted,
			corrections,
		}: {
			taskId: string;
			accepted: boolean;
			corrections?: Record<string, unknown>;
		}) => {
			return orpc.admin.stores.verifyEnrichment.call({
				taskId,
				accepted,
				corrections,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["admin", "stores", "getStoreDetail"],
			});
			queryClient.invalidateQueries({
				queryKey: ["admin", "stores", "getEnrichmentTasks"],
			});
			setVerifyModalOpen(false);
			setSelectedTask(null);
		},
		onError: (err) => {
			setError(err instanceof Error ? err.message : "Verification failed");
		},
	});

	const handleApprove = async () => {
		if (!store || !onApprove) return;

		if (!store.updatedAt) {
			setError(
				"Cannot approve store: missing update timestamp. Please refresh and try again.",
			);
			return;
		}

		setActionInProgress("approve");
		setError(null);
		setIsConflictError(false);

		try {
			await onApprove(
				store.id,
				store.updatedAt.toISOString(),
				approvalNotes.trim() || undefined,
			);
			setApprovalNotes("");
			setShowForceApprove(false);
			onOpenChange(false);
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : "Approval failed";
			// Check if this is a conflict error (store was modified by someone else)
			if (
				errorMessage.includes("modified by someone else") ||
				errorMessage.includes("refresh")
			) {
				setIsConflictError(true);
			}
			setError(errorMessage);
		} finally {
			setActionInProgress(null);
		}
	};

	const handleForceApprove = async () => {
		if (!store || !onForceApprove) return;

		if (!forceApproveJustification.trim()) {
			setError("Please provide a justification for force approval");
			return;
		}

		if (!store.updatedAt) {
			setError(
				"Cannot force approve store: missing update timestamp. Please refresh and try again.",
			);
			return;
		}

		setActionInProgress("force-approve");
		setError(null);
		setIsConflictError(false);

		try {
			await onForceApprove(
				store.id,
				store.updatedAt.toISOString(),
				approvalNotes.trim() || undefined,
				forceApproveJustification.trim(),
			);
			setApprovalNotes("");
			setForceApproveJustification("");
			setShowForceApprove(false);
			onOpenChange(false);
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : "Force approval failed";
			if (
				errorMessage.includes("modified by someone else") ||
				errorMessage.includes("refresh")
			) {
				setIsConflictError(true);
			}
			setError(errorMessage);
		} finally {
			setActionInProgress(null);
		}
	};

	const handleReject = async () => {
		if (!store || !onReject) return;

		if (!rejectReason.trim()) {
			setError("Please provide a reason for rejection");
			return;
		}

		if (!store.updatedAt) {
			setError(
				"Cannot reject store: missing update timestamp. Please refresh and try again.",
			);
			return;
		}

		setActionInProgress("reject");
		setError(null);
		setIsConflictError(false);

		try {
			await onReject(store.id, store.updatedAt.toISOString());
			setRejectReason("");
			onOpenChange(false);
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : "Rejection failed";
			// Check if this is a conflict error (store was modified by someone else)
			if (
				errorMessage.includes("modified by someone else") ||
				errorMessage.includes("refresh")
			) {
				setIsConflictError(true);
			}
			setError(errorMessage);
		} finally {
			setActionInProgress(null);
		}
	};

	const handleMerge = () => {
		if (!store || !onMerge) return;
		onMerge(store.id);
		onOpenChange(false);
	};

	const handleAcceptVerify = async (
		taskId: string,
		corrections?: Record<string, unknown>,
	) => {
		await verifyMutation.mutateAsync({
			taskId,
			accepted: true,
			corrections,
		});
	};

	const handleRejectVerify = async (taskId: string) => {
		await verifyMutation.mutateAsync({
			taskId,
			accepted: false,
		});
	};

	const handleClose = (open: boolean) => {
		if (!open) {
			setApprovalNotes("");
			setRejectReason("");
			setForceApproveJustification("");
			setShowForceApprove(false);
			setError(null);
			setSelectedTask(null);
			setIsConflictError(false);
		}
		onOpenChange(open);
	};

	const handleRefresh = () => {
		// Refetch the store details
		queryClient.invalidateQueries({
			queryKey: ["admin", "stores", "getDetail", storeId],
		});
		setError(null);
		setIsConflictError(false);
	};

	// Check if store has failed enrichment tasks
	const hasFailedTasks = enrichmentTasks.some(
		(task) => task.status === "failed",
	);

	if (!storeId) return null;

	return (
		<>
			<Dialog open={open} onOpenChange={handleClose}>
				<DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
					{isLoadingDetail ? (
						<div className="flex items-center justify-center py-12">
							<div className="flex flex-col items-center gap-3">
								<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
								<p className="text-sm text-muted-foreground">
									Loading store details...
								</p>
							</div>
						</div>
					) : !store ? (
						<div className="flex items-center justify-center py-12">
							<div className="text-center">
								<Store className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
								<h3 className="font-medium text-lg text-foreground mb-1">
									Store not found
								</h3>
							</div>
						</div>
					) : (
						<>
							<DialogHeader>
								<div className="flex items-start justify-between">
									<div className="flex-1">
										<DialogTitle className="flex items-center gap-2">
											<Store className="h-5 w-5" />
											{store.name}
										</DialogTitle>
										<DialogDescription className="mt-1">
											Store ID: {store.id}
										</DialogDescription>
									</div>
									<StoreStatusBadge status={store.status} />
								</div>
							</DialogHeader>

							{error && (
								<div
									className={`rounded-md border p-3 ${
										isConflictError
											? "bg-amber-50/50 border-amber-300 dark:bg-amber-950/20 dark:border-amber-800"
											: "bg-destructive/10 border-destructive/30"
									}`}
								>
									<div className="flex items-start gap-3">
										{isConflictError ? (
											<AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
										) : (
											<AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
										)}
										<div className="flex-1">
											<p
												className={`text-sm font-medium ${
													isConflictError
														? "text-amber-800 dark:text-amber-300"
														: "text-destructive"
												}`}
											>
												{isConflictError
													? "Concurrent Modification Detected"
													: "Error"}
											</p>
											<p
												className={`text-sm mt-1 ${
													isConflictError
														? "text-amber-700 dark:text-amber-400"
														: "text-destructive"
												}`}
											>
												{error}
											</p>
											{isConflictError && (
												<div className="flex items-center gap-2 mt-3">
													<Button
														size="sm"
														variant="outline"
														onClick={handleRefresh}
														className="h-8 text-xs"
													>
														<RefreshCw className="h-3 w-3 mr-1" />
														Refresh Store Data
													</Button>
													<span className="text-xs text-amber-700 dark:text-amber-500">
														This will reload the latest store information
													</span>
												</div>
											)}
										</div>
									</div>
								</div>
							)}

							{/* Store Information */}
							<div className="space-y-4">
								<Card>
									<CardHeader className="pb-3">
										<CardTitle className="text-base flex items-center gap-2">
											<Store className="h-4 w-4" />
											Store Information
										</CardTitle>
									</CardHeader>
									<CardContent className="space-y-3">
										<div className="grid grid-cols-2 gap-4">
											<div>
												<span className="text-xs font-medium text-muted-foreground">
													Chain
												</span>
												<p className="text-sm">
													{store.chainSlug.toUpperCase()}
												</p>
											</div>
											<div>
												<span className="text-xs font-medium text-muted-foreground">
													Type
												</span>
												<p className="text-sm">
													{store.isVirtual ? "Virtual Store" : "Physical Store"}
												</p>
											</div>
										</div>
										<Separator />
										<div>
											<span className="text-xs font-medium text-muted-foreground">
												Address
											</span>
											<p className="text-sm">
												{store.address || "No address provided"}
											</p>
											{store.city && (
												<p className="text-sm text-muted-foreground">
													{store.city}
													{store.postalCode && ` ${store.postalCode}`}
												</p>
											)}
										</div>
										{store.priceSourceStoreId && (
											<div>
												<span className="text-xs font-medium text-muted-foreground">
													Price Source
												</span>
												<p className="text-sm font-mono text-xs">
													{store.priceSourceStoreId}
												</p>
											</div>
										)}
										<Separator />
										<div className="grid grid-cols-2 gap-4">
											<div>
												<span className="text-xs font-medium text-muted-foreground">
													Created
												</span>
												<p className="text-sm">
													{store.createdAt
														? new Date(store.createdAt).toLocaleString()
														: "Unknown"}
												</p>
											</div>
											<div>
												<span className="text-xs font-medium text-muted-foreground">
													Updated
												</span>
												<p className="text-sm">
													{store.updatedAt
														? new Date(store.updatedAt).toLocaleString()
														: "Unknown"}
												</p>
											</div>
										</div>
										{(store.approvedBy ||
											store.approvedAt ||
											store.approvalNotes) && (
											<>
												<Separator />
												<div>
													<span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
														<Lock className="h-3 w-3" />
														Approval Information
													</span>
													<div className="mt-1 space-y-1">
														{store.approvedBy && (
															<p className="text-sm">
																Approved by:{" "}
																<span className="font-medium">
																	{store.approvedBy}
																</span>
															</p>
														)}
														{store.approvedAt && (
															<p className="text-sm flex items-center gap-1">
																<Calendar className="h-3 w-3" />
																{new Date(store.approvedAt).toLocaleString()}
															</p>
														)}
														{store.approvalNotes && (
															<div className="rounded-md bg-muted/50 p-2 mt-2">
																<p className="text-xs font-medium text-muted-foreground mb-1">
																	Notes:
																</p>
																<p className="text-sm">{store.approvalNotes}</p>
															</div>
														)}
													</div>
												</div>
											</>
										)}
									</CardContent>
								</Card>

								{/* Location Map */}
								{(store.latitude || store.longitude) && (
									<Card>
										<CardHeader className="pb-3">
											<CardTitle className="text-base flex items-center gap-2">
												<MapPin className="h-4 w-4" />
												Location
											</CardTitle>
										</CardHeader>
										<CardContent>
											<StoreLocationMap
												latitude={store.latitude}
												longitude={store.longitude}
												storeName={store.name}
												className="h-64"
											/>
										</CardContent>
									</Card>
								)}

								{/* Enrichment Section */}
								{storeId && store && (
									<StoreEnrichmentSection storeId={storeId} store={store} />
								)}

								{/* Similar Stores */}
								{similarStores.length > 0 && (
									<Card>
										<CardHeader className="pb-3">
											<CardTitle className="text-base flex items-center gap-2">
												<Store className="h-4 w-4" />
												Similar Stores
												<Badge variant="outline" className="text-xs">
													{similarStores.length}
												</Badge>
											</CardTitle>
											<CardDescription>
												Other stores in the same chain and city
											</CardDescription>
										</CardHeader>
										<CardContent>
											<div className="space-y-2">
												{similarStores.map((similar) => (
													<div
														key={similar.id}
														className="flex items-center justify-between p-2 rounded-md border border-border hover:bg-accent/50"
													>
														<div>
															<p className="text-sm font-medium">
																{similar.name}
															</p>
															<p className="text-xs text-muted-foreground">
																{similar.address ||
																	similar.city ||
																	"No address"}
															</p>
														</div>
														<Button
															variant="ghost"
															size="sm"
															onClick={() => {
																/* TODO: navigate to store */
															}}
														>
															View <ArrowRight className="h-3 w-3 ml-1" />
														</Button>
													</div>
												))}
											</div>
										</CardContent>
									</Card>
								)}

								{/* Linked Physical Stores */}
								{store.isVirtual && linkedPhysicalStores.length > 0 && (
									<Card>
										<CardHeader className="pb-3">
											<CardTitle className="text-base flex items-center gap-2">
												<Store className="h-4 w-4" />
												Linked Physical Stores
												<Badge variant="outline" className="text-xs">
													{linkedPhysicalStores.length}
												</Badge>
											</CardTitle>
											<CardDescription>
												Physical locations using this virtual store as price
												source
											</CardDescription>
										</CardHeader>
										<CardContent>
											<div className="space-y-2">
												{linkedPhysicalStores.map((linked) => (
													<div
														key={linked.id}
														className="flex items-center justify-between p-2 rounded-md border border-border hover:bg-accent/50"
													>
														<div>
															<p className="text-sm font-medium">
																{linked.name}
															</p>
															<p className="text-xs text-muted-foreground">
																{linked.address || linked.city || "No address"}
															</p>
														</div>
														<Button
															variant="ghost"
															size="sm"
															onClick={() => {
																/* TODO: navigate to store */
															}}
														>
															View <ArrowRight className="h-3 w-3 ml-1" />
														</Button>
													</div>
												))}
											</div>
										</CardContent>
									</Card>
								)}

								{/* Actions Section for Pending Stores */}
								{store.status === "pending" && (
									<Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
										<CardHeader className="pb-3">
											<CardTitle className="text-base flex items-center gap-2">
												<Sparkles className="h-4 w-4" />
												Review Actions
											</CardTitle>
											<CardDescription>
												Decide what to do with this pending store
											</CardDescription>
										</CardHeader>
										<CardContent className="space-y-4">
											{/* Enrichment Retry */}
											{hasFailedTasks && (
												<div className="rounded-md bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-800 p-3">
													<div className="flex items-start gap-2">
														<Brain className="h-4 w-4 text-yellow-700 dark:text-yellow-400 mt-0.5" />
														<div className="flex-1">
															<p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
																Some enrichment tasks failed
															</p>
															<p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1">
																You can retry the enrichment tasks from the Data
																Enrichment section above.
															</p>
														</div>
													</div>
												</div>
											)}

											{/* Approve Action */}
											<div className="space-y-2">
												<label className="text-sm font-medium text-foreground">
													Approve Store
												</label>
												<Textarea
													value={approvalNotes}
													onChange={(e) => setApprovalNotes(e.target.value)}
													placeholder="Add optional approval notes (e.g., why this store was approved, any special handling needed)..."
													className="min-h-[60px] resize-none"
												/>
												<div className="flex gap-2">
													<Button
														onClick={handleApprove}
														disabled={
															actionInProgress === "approve" ||
															actionInProgress === "force-approve"
														}
														className="flex-1 bg-green-600 hover:bg-green-700 text-white"
													>
														{actionInProgress === "approve" ? (
															<>
																<Loader2 className="h-4 w-4 mr-2 animate-spin" />
																Approving...
															</>
														) : (
															<>
																<Check className="h-4 w-4 mr-2" />
																Approve
															</>
														)}
													</Button>
													{!showForceApprove ? (
														<Button
															onClick={() => setShowForceApprove(true)}
															disabled={
																actionInProgress === "approve" ||
																actionInProgress === "force-approve"
															}
															variant="outline"
															className="text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-950/20"
														>
															<AlertTriangle className="h-4 w-4 mr-1" />
															Force Approve
														</Button>
													) : (
														<Button
															onClick={() => setShowForceApprove(false)}
															variant="ghost"
															size="sm"
														>
															Cancel
														</Button>
													)}
												</div>
											</div>

											{/* Force Approve Justification */}
											{showForceApprove && (
												<div className="rounded-md bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-800 p-3 space-y-2">
													<div className="flex items-start gap-2">
														<AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
														<div className="flex-1">
															<p className="text-sm font-medium text-amber-800 dark:text-amber-300">
																Force Approval Required
															</p>
															<p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
																Skipping enrichment requires documented
																justification for audit purposes.
															</p>
														</div>
													</div>
													<Textarea
														value={forceApproveJustification}
														onChange={(e) =>
															setForceApproveJustification(e.target.value)
														}
														placeholder="Explain why enrichment should be skipped (e.g., 'Store data verified manually', 'Known location from field visit', 'Legacy store with verified data')..."
														className="min-h-[80px] resize-none"
														required
													/>
													<Button
														onClick={handleForceApprove}
														disabled={
															actionInProgress === "force-approve" ||
															!forceApproveJustification.trim()
														}
														variant="outline"
														className="w-full border-amber-500 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/20"
													>
														{actionInProgress === "force-approve" ? (
															<>
																<Loader2 className="h-4 w-4 mr-2 animate-spin" />
																Force Approving...
															</>
														) : (
															<>
																<Check className="h-4 w-4 mr-2" />
																Confirm Force Approval
															</>
														)}
													</Button>
												</div>
											)}

											<Separator />

											{/* Reject Action */}
											<div className="space-y-2">
												<label className="text-sm font-medium text-foreground">
													Reject Store
												</label>
												<Textarea
													value={rejectReason}
													onChange={(e) => setRejectReason(e.target.value)}
													placeholder="Please provide a reason for rejection..."
													className="min-h-[60px] resize-none"
												/>
												<Button
													onClick={handleReject}
													disabled={actionInProgress === "reject"}
													variant="destructive"
													className="w-full"
												>
													{actionInProgress === "reject" ? (
														<>
															<Loader2 className="h-4 w-4 mr-2 animate-spin" />
															Rejecting...
														</>
													) : (
														<>
															<X className="h-4 w-4 mr-2" />
															Reject Store
														</>
													)}
												</Button>
											</div>

											{onMerge && (
												<>
													<Separator />
													<Button
														onClick={handleMerge}
														variant="outline"
														className="w-full"
													>
														<FileText className="h-4 w-4 mr-2" />
														Merge with Existing Store
													</Button>
												</>
											)}
										</CardContent>
									</Card>
								)}
							</div>

							<DialogFooter>
								<Button variant="outline" onClick={() => handleClose(false)}>
									Close
								</Button>
							</DialogFooter>
						</>
					)}
				</DialogContent>
			</Dialog>

			{/* Verify Location Modal */}
			<VerifyLocationModal
				task={selectedTask}
				open={verifyModalOpen}
				onOpenChange={setVerifyModalOpen}
				onAccept={handleAcceptVerify}
				onReject={handleRejectVerify}
				isLoading={verifyMutation.isPending}
			/>
		</>
	);
}
