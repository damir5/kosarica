import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/barcode-triage")({
	component: AdminBarcodeTriagePage,
});

type QueueInput = Parameters<typeof orpc.admin.barcodeTriage.getQueue.call>[0];

function AdminBarcodeTriagePage() {
	const queryClient = useQueryClient();
	const [chainSlug, setChainSlug] = useState("");
	const [category, setCategory] = useState("");
	const [status, setStatus] = useState<QueueInput["status"]>("all");
	const [selectedBarcode, setSelectedBarcode] = useState<string>("");
	const [searchTerm, setSearchTerm] = useState("");
	const [selectedSkuId, setSelectedSkuId] = useState("");

	const queueInput = useMemo<QueueInput>(
		() => ({
			limit: 40,
			offset: 0,
			chainSlug: chainSlug.trim() || undefined,
			category: category.trim() || undefined,
			status,
		}),
		[chainSlug, category, status],
	);

	const queueQuery = useQuery(
		orpc.admin.barcodeTriage.getQueue.queryOptions({
			input: queueInput,
		}),
	);
	const queueItems = queueQuery.data?.items ?? [];

	useEffect(() => {
		if (!selectedBarcode && queueItems.length > 0) {
			setSelectedBarcode(queueItems[0].barcode);
		}
	}, [selectedBarcode, queueItems]);

	const detailQuery = useQuery({
		...orpc.admin.barcodeTriage.getClusterDetail.queryOptions({
			input: {
				barcode: selectedBarcode,
			},
		}),
		enabled: selectedBarcode.length > 0,
	});

	const skuQuery = useQuery({
		...orpc.admin.barcodeTriage.searchCanonicalSkus.queryOptions({
			input: {
				query: searchTerm.length > 0 ? searchTerm : "a",
				limit: 10,
			},
		}),
		enabled: searchTerm.length >= 2,
	});

	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: orpc.admin.barcodeTriage.key({ type: "query" }),
		});
	};

	const claimMutation = useMutation({
		mutationFn: (barcode: string) =>
			orpc.admin.barcodeTriage.claim.call({ barcode }),
		onSuccess: () => invalidate(),
	});

	const decisionMutation = useMutation({
		mutationFn: (
			payload: Parameters<typeof orpc.admin.barcodeTriage.submitDecision.call>[0],
		) => orpc.admin.barcodeTriage.submitDecision.call(payload),
		onSuccess: async () => {
			invalidate();
			await queryClient.invalidateQueries({
				queryKey: orpc.admin.barcodeTriage.getClusterDetail.key({ type: "query" }),
			});
			goNext();
		},
	});

	const goNext = () => {
		const currentIndex = queueItems.findIndex(
			(item) => item.barcode === selectedBarcode,
		);
		if (currentIndex >= 0 && currentIndex + 1 < queueItems.length) {
			setSelectedBarcode(queueItems[currentIndex + 1].barcode);
		}
	};

	const submitCreate = () => {
		if (!selectedBarcode) return;
		const fallbackName =
			detailQuery.data?.items[0]?.name ?? `EAN ${selectedBarcode}`;
		decisionMutation.mutate({
			decisionType: "create_new_sku",
			barcode: selectedBarcode,
			canonicalName: fallbackName,
			packAmount: detailQuery.data?.items[0]?.packAmount ?? 1,
		});
	};

	const submitMap = () => {
		if (!selectedBarcode || !selectedSkuId) return;
		decisionMutation.mutate({
			decisionType: "map_existing_sku",
			barcode: selectedBarcode,
			canonicalSkuId: selectedSkuId,
		});
	};

	const submitNotMatch = () => {
		if (!selectedBarcode) return;
		decisionMutation.mutate({
			decisionType: "not_match",
			barcode: selectedBarcode,
			reason: "different_product",
		});
	};

	const bulkApproveMutation = useMutation({
		mutationFn: async () => {
			const eligible = queueItems.filter(
				(item) =>
					item.chainCount >= 3 &&
					item.categoryAgreement === 1 &&
					item.priceVariance != null &&
					item.priceVariance < 0.3,
			);
			for (const item of eligible) {
				await orpc.admin.barcodeTriage.submitDecision.call({
					decisionType: "create_new_sku",
					barcode: item.barcode,
					canonicalName: `EAN ${item.barcode}`,
					packAmount: 1,
				});
			}
			return eligible.length;
		},
		onSuccess: () => invalidate(),
	});
	const backgroundTriageMutation = useMutation({
		mutationFn: () =>
			orpc.admin.barcodeTriage.triggerAutoTriage.call({
				minChains: 2,
			}),
	});
	const queueErrorMessage =
		queueQuery.error instanceof Error
			? queueQuery.error.message
			: "Failed to load barcode triage queue";
	const detailErrorMessage =
		detailQuery.error instanceof Error
			? detailQuery.error.message
			: "Failed to load barcode cluster";
	const decisionErrorMessage =
		decisionMutation.error instanceof Error
			? decisionMutation.error.message
			: "Failed to submit triage decision";
	const bulkErrorMessage =
		bulkApproveMutation.error instanceof Error
			? bulkApproveMutation.error.message
			: "Failed to auto-approve queue items";
	const backgroundTriageErrorMessage =
		backgroundTriageMutation.error instanceof Error
			? backgroundTriageMutation.error.message
			: "Failed to start background triage";

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (
				event.target instanceof HTMLInputElement ||
				event.target instanceof HTMLTextAreaElement ||
				event.target instanceof HTMLSelectElement
			) {
				return;
			}
			if (
				event.target instanceof HTMLElement &&
				event.target.isContentEditable
			) {
				return;
			}
			const key = event.key.toLowerCase();
			if (key === "s") {
				event.preventDefault();
				goNext();
			}
			if (key === "c") {
				event.preventDefault();
				submitCreate();
			}
			if (key === "m") {
				event.preventDefault();
				submitMap();
			}
			if (key === "n") {
				event.preventDefault();
				submitNotMatch();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [selectedBarcode, selectedSkuId, queueItems, detailQuery.data]);

	return (
		<div className="mx-auto max-w-7xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h1 className="font-semibold text-2xl">Barcode Triage</h1>
					<p className="text-muted-foreground text-sm">
						Decision workflow: keyboard shortcuts `S / C / M / N`.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="outline" onClick={() => invalidate()}>
						<RefreshCw className="mr-2 h-4 w-4" />
						Refresh
					</Button>
					<Button
						variant="secondary"
						onClick={() => bulkApproveMutation.mutate()}
						disabled={bulkApproveMutation.isPending}
					>
						Auto-approve 3+ chains
					</Button>
					<Button
						variant="secondary"
						onClick={() => backgroundTriageMutation.mutate()}
						disabled={backgroundTriageMutation.isPending}
					>
						Triage All In Background
					</Button>
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Filters</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-2 md:grid-cols-4">
					<Input
						placeholder="Chain slug"
						value={chainSlug}
						onChange={(event) => setChainSlug(event.target.value)}
					/>
					<Input
						placeholder="Category"
						value={category}
						onChange={(event) => setCategory(event.target.value)}
					/>
					<select
						className="h-9 rounded-md border bg-background px-3 text-sm"
						value={status}
						onChange={(event) => setStatus(event.target.value as QueueInput["status"])}
					>
						<option value="all">All</option>
						<option value="mine">Mine</option>
						<option value="unclaimed">Unclaimed</option>
					</select>
					<div className="flex items-center text-muted-foreground text-sm">
						{queueQuery.data?.total ?? 0} pending
					</div>
				</CardContent>
			</Card>
			{decisionMutation.isError ? (
				<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
					{decisionErrorMessage}
				</div>
			) : null}
			{bulkApproveMutation.isError ? (
				<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
					{bulkErrorMessage}
				</div>
			) : null}
			{backgroundTriageMutation.isError ? (
				<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
					{backgroundTriageErrorMessage}
				</div>
			) : null}
			{backgroundTriageMutation.isSuccess ? (
				<div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">
					Background triage task queued: {backgroundTriageMutation.data.taskId}
				</div>
			) : null}

			<div className="grid gap-4 lg:grid-cols-[320px_1fr]">
				<Card>
					<CardHeader>
						<CardTitle>Queue</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						{queueQuery.isLoading ? (
							<div className="flex items-center gap-2 text-muted-foreground text-sm">
								<Loader2 className="h-4 w-4 animate-spin" />
								Loading...
							</div>
						) : queueQuery.isError ? (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
								{queueErrorMessage}
							</div>
						) : (
							queueItems.map((item) => (
								<button
									type="button"
									key={item.barcode}
									className={`w-full rounded-md border p-2 text-left text-sm ${
										item.barcode === selectedBarcode
											? "border-primary bg-primary/5"
											: "border-border"
									}`}
									onClick={() => {
										setSelectedBarcode(item.barcode);
										claimMutation.mutate(item.barcode);
									}}
								>
									<div className="font-medium">{item.barcode}</div>
									<div className="text-muted-foreground text-xs">
										{item.itemCount} items · {item.chainCount} chains · score{" "}
										{item.priorityScore}
									</div>
								</button>
							))
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Cluster Detail</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{detailQuery.isLoading ? (
							<div className="flex items-center gap-2 text-muted-foreground text-sm">
								<Loader2 className="h-4 w-4 animate-spin" />
								Loading cluster...
							</div>
						) : detailQuery.isError ? (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
								{detailErrorMessage}
							</div>
						) : (
							<>
								<div className="text-sm">Barcode: {selectedBarcode || "-"}</div>
								<div className="overflow-x-auto">
									<table className="min-w-full text-sm">
										<thead>
											<tr className="border-b text-left">
												<th className="px-2 py-1">Chain</th>
												<th className="px-2 py-1">Name</th>
												<th className="px-2 py-1">Brand</th>
												<th className="px-2 py-1">Category</th>
												<th className="px-2 py-1">Qty</th>
												<th className="px-2 py-1">Price</th>
											</tr>
										</thead>
										<tbody>
											{(detailQuery.data?.items ?? []).map((item) => (
												<tr key={item.retailerItemId} className="border-b">
													<td className="px-2 py-1">{item.chainSlug ?? "-"}</td>
													<td className="px-2 py-1">{item.name}</td>
													<td className="px-2 py-1">{item.brand ?? "-"}</td>
													<td className="px-2 py-1">{item.category ?? "-"}</td>
													<td className="px-2 py-1">
														{item.totalAmount ?? "-"} {item.extractedUnit ?? ""}
													</td>
													<td className="px-2 py-1">
														{item.priceCents == null
															? "-"
															: (item.priceCents / 100).toFixed(2)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>

								<div className="grid gap-2 md:grid-cols-2">
									<Button onClick={submitCreate} disabled={decisionMutation.isPending}>
										Create SKU [C]
									</Button>
									<Button
										variant="destructive"
										onClick={submitNotMatch}
										disabled={decisionMutation.isPending}
									>
										Not a match [N]
									</Button>
								</div>

								<div className="space-y-2 rounded-md border p-3">
									<Label>Map to existing SKU [M]</Label>
									<Input
										placeholder="Search SKU"
										value={searchTerm}
										onChange={(event) => setSearchTerm(event.target.value)}
									/>
									<select
										className="h-9 w-full rounded-md border bg-background px-3 text-sm"
										value={selectedSkuId}
										onChange={(event) => setSelectedSkuId(event.target.value)}
									>
										<option value="">Select SKU</option>
										{(skuQuery.data?.items ?? []).map((sku) => (
											<option key={sku.id} value={sku.id}>
												{sku.canonicalName}
											</option>
										))}
									</select>
									{skuQuery.isError ? (
										<div className="text-destructive text-xs">
											Failed to load SKU suggestions.
										</div>
									) : null}
									<Button
										variant="outline"
										onClick={submitMap}
										disabled={selectedSkuId.length === 0 || decisionMutation.isPending}
									>
										Map to SKU
									</Button>
								</div>
							</>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
