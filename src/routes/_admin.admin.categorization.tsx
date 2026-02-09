import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Filter, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { DebouncedInput } from "@/components/ui/debounced-input";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/categorization")({
	component: AdminCategorizationPage,
});

type StatusFilter = "all" | "pending" | "escalated" | "done";

type ListInput = Parameters<typeof orpc.admin.categorization.list.call>[0];

function AdminCategorizationPage() {
	const queryClient = useQueryClient();
	const [status, setStatus] = useState<StatusFilter>("all");
	const [chainSlug, setChainSlug] = useState<string>("");
	const [productType, setProductType] = useState<string>("");
	const [page, setPage] = useState<number>(1);
	const [selectedItem, setSelectedItem] = useState<{
		itemId: string;
		originalName: string;
		everydayName: string | null;
		productType: string | null;
		brand: string | null;
		variant: string | null;
		extractedAmount: number | null;
		extractedUnit: string | null;
		packAmount: number | null;
		containerType: string | null;
		searchTags: string[];
	} | null>(null);
	const pageSize = 50;

	const listInput = useMemo<ListInput>(() => {
		return {
			status,
			chainSlug: chainSlug.trim().length > 0 ? chainSlug.trim() : undefined,
			productType: productType.trim().length > 0 ? productType.trim() : undefined,
			limit: pageSize,
			offset: (page - 1) * pageSize,
		};
	}, [status, chainSlug, productType, page]);

	const statsQuery = useQuery(orpc.admin.categorization.getStats.queryOptions({}));
	const listQuery = useQuery(
		orpc.admin.categorization.list.queryOptions({
			input: listInput as never,
		}),
	);

	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: orpc.admin.categorization.key({ type: "query" }),
		});
	};

	const triggerMutation = useMutation({
		mutationFn: async () => {
			return orpc.admin.categorization.trigger.call({ async: true });
		},
		onSuccess: () => invalidate(),
	});

	const updateMutation = useMutation({
		mutationFn: async (payload: Parameters<typeof orpc.admin.categorization.update.call>[0]) => {
			return orpc.admin.categorization.update.call(payload);
		},
		onSuccess: () => {
			setSelectedItem(null);
			invalidate();
		},
	});

	const items = listQuery.data?.items ?? [];
	const total = listQuery.data?.total ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	const triggerErrorMessage =
		triggerMutation.error instanceof Error
			? triggerMutation.error.message
			: "Failed to start categorization backfill";
	const listErrorMessage =
		listQuery.error instanceof Error
			? listQuery.error.message
			: "Failed to load categorization rows";
	const statsErrorMessage =
		statsQuery.error instanceof Error
			? statsQuery.error.message
			: "Failed to load categorization stats";

	const [editEverydayName, setEditEverydayName] = useState<string>("");
	const [editProductType, setEditProductType] = useState<string>("");
	const [editBrand, setEditBrand] = useState<string>("");
	const [editVariant, setEditVariant] = useState<string>("");
	const [editAmount, setEditAmount] = useState<string>("");
	const [editUnit, setEditUnit] = useState<string>("");
	const [editPackAmount, setEditPackAmount] = useState<string>("");
	const [editContainer, setEditContainer] = useState<string>("none");
	const [editSearchTags, setEditSearchTags] = useState<string>("");

	return (
		<div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-semibold text-2xl">Categorization</h1>
					<p className="text-muted-foreground text-sm">
						LLM-derived normalized item metadata and manual overrides.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="outline" onClick={invalidate}>
						<RefreshCw className="mr-2 h-4 w-4" />
						Refresh
					</Button>
					<Button
						onClick={() => triggerMutation.mutate()}
						disabled={triggerMutation.isPending}
					>
						{triggerMutation.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Sparkles className="mr-2 h-4 w-4" />
						)}
						Trigger Backfill
					</Button>
				</div>
			</div>

			<div className="grid gap-4 md:grid-cols-4">
				<StatCard label="Total Items" value={statsQuery.data?.total ?? 0} />
				<StatCard label="Categorized" value={statsQuery.data?.categorized ?? 0} />
				<StatCard label="Pending" value={statsQuery.data?.pending ?? 0} />
				<StatCard label="Escalated" value={statsQuery.data?.escalated ?? 0} />
			</div>
			{statsQuery.isError ? (
				<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
					{statsErrorMessage}
				</div>
			) : null}
			{triggerMutation.isSuccess && triggerMutation.data?.queued ? (
				<div className="rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700">
					Backfill task queued: {triggerMutation.data.taskId}
				</div>
			) : null}
			{triggerMutation.isError ? (
				<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
					{triggerErrorMessage}
				</div>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Filter className="h-4 w-4" />
						Filters
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="grid gap-3 md:grid-cols-4">
						<Select
							value={status}
							onValueChange={(value) => {
								setStatus(value as StatusFilter);
								setPage(1);
							}}
						>
							<SelectTrigger>
								<SelectValue placeholder="Status" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All</SelectItem>
								<SelectItem value="pending">Pending</SelectItem>
								<SelectItem value="escalated">Escalated</SelectItem>
								<SelectItem value="done">Done</SelectItem>
							</SelectContent>
						</Select>
						<DebouncedInput
							placeholder="Chain slug"
							value={chainSlug}
							onChange={(value) => {
								setChainSlug(String(value));
								setPage(1);
							}}
						/>
						<DebouncedInput
							placeholder="Product type"
							value={productType}
							onChange={(value) => {
								setProductType(String(value));
								setPage(1);
							}}
						/>
						<div className="text-muted-foreground text-sm">
							{total.toLocaleString()} result{total === 1 ? "" : "s"}
						</div>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Items</CardTitle>
					<CardDescription>
						Original and normalized data side-by-side.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{listQuery.isLoading ? (
						<div className="flex items-center gap-2 text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" />
							Loading categorizations...
						</div>
					) : listQuery.isError ? (
						<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
							{listErrorMessage}
						</div>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Chain</TableHead>
										<TableHead>Original</TableHead>
										<TableHead>Everyday Name</TableHead>
										<TableHead>Type</TableHead>
										<TableHead>Brand</TableHead>
										<TableHead>Variant</TableHead>
										<TableHead>Amount</TableHead>
										<TableHead>Container</TableHead>
										<TableHead>Confidence</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Model</TableHead>
										<TableHead />
									</TableRow>
								</TableHeader>
								<TableBody>
									{items.map((item) => {
										const amount = item.extractedAmount
											? `${item.extractedAmount}${item.extractedUnit ?? ""}`
											: "-";
										const pack = item.packAmount ? ` x${item.packAmount}` : "";
										return (
											<TableRow key={item.itemId}>
												<TableCell>{item.chainSlug ?? "-"}</TableCell>
												<TableCell className="max-w-xs truncate">
													{item.originalName}
												</TableCell>
												<TableCell className="max-w-xs truncate">
													{item.everydayName ?? "-"}
												</TableCell>
												<TableCell>{item.productType ?? "-"}</TableCell>
												<TableCell>{item.brand ?? "-"}</TableCell>
												<TableCell>{item.variant ?? "-"}</TableCell>
												<TableCell>{`${amount}${pack}`}</TableCell>
												<TableCell>{item.containerType ?? "-"}</TableCell>
												<TableCell>
													{item.confidence == null
														? "-"
														: item.confidence.toFixed(2)}
												</TableCell>
												<TableCell>
													{item.needsReview ? (
														<Badge variant="destructive">Escalated</Badge>
													) : item.categorizedAt ? (
														<Badge>Done</Badge>
													) : (
														<Badge variant="outline">Pending</Badge>
													)}
												</TableCell>
												<TableCell className="max-w-[220px] truncate font-mono text-xs">
													{item.model ?? "-"}
												</TableCell>
												<TableCell>
													<Button
														size="sm"
														variant="outline"
														onClick={() => {
															setSelectedItem({
																itemId: item.itemId,
																originalName: item.originalName,
																everydayName: item.everydayName,
																productType: item.productType,
																brand: item.brand,
																variant: item.variant,
																extractedAmount: item.extractedAmount,
																extractedUnit: item.extractedUnit,
																packAmount: item.packAmount,
																containerType: item.containerType,
																searchTags: item.searchTags,
															});
															setEditEverydayName(item.everydayName ?? "");
															setEditProductType(item.productType ?? "");
															setEditBrand(item.brand ?? "");
															setEditVariant(item.variant ?? "");
															setEditAmount(
																item.extractedAmount == null
																	? ""
																	: String(item.extractedAmount),
															);
															setEditUnit(item.extractedUnit ?? "");
															setEditPackAmount(
																item.packAmount == null
																	? ""
																	: String(item.packAmount),
															);
															setEditContainer(item.containerType ?? "none");
															setEditSearchTags(item.searchTags.join(", "));
														}}
													>
														Edit
													</Button>
												</TableCell>
											</TableRow>
										);
									})}
									{items.length === 0 && (
										<TableRow>
											<TableCell colSpan={12} className="py-8 text-center">
												No items for current filters.
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
						</div>
					)}
					<div className="mt-4 flex items-center justify-between">
						<div className="text-muted-foreground text-sm">
							Page {page} / {totalPages}
						</div>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={page <= 1}
								onClick={() => setPage((p) => Math.max(1, p - 1))}
							>
								Previous
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={page >= totalPages}
								onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
							>
								Next
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			<Dialog
				open={selectedItem != null}
				onOpenChange={(open) => {
					if (!open) {
						setSelectedItem(null);
					}
				}}
			>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Edit Categorization</DialogTitle>
					</DialogHeader>
					<div className="grid gap-4">
						<div className="text-muted-foreground text-sm">
							Original: {selectedItem?.originalName}
						</div>
						<div className="grid gap-3 md:grid-cols-2">
							<div className="space-y-1">
								<Label>Everyday Name</Label>
								<Input
									value={editEverydayName}
									onChange={(event) => setEditEverydayName(event.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label>Product Type</Label>
								<Input
									value={editProductType}
									onChange={(event) => setEditProductType(event.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label>Brand</Label>
								<Input
									value={editBrand}
									onChange={(event) => setEditBrand(event.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label>Variant</Label>
								<Input
									value={editVariant}
									onChange={(event) => setEditVariant(event.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label>Amount</Label>
								<Input
									value={editAmount}
									onChange={(event) => setEditAmount(event.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label>Unit</Label>
								<Select value={editUnit || "none"} onValueChange={setEditUnit}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">None</SelectItem>
										<SelectItem value="g">g</SelectItem>
										<SelectItem value="kg">kg</SelectItem>
										<SelectItem value="ml">ml</SelectItem>
										<SelectItem value="l">l</SelectItem>
										<SelectItem value="kom">kom</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1">
								<Label>Pack Amount</Label>
								<Input
									value={editPackAmount}
									onChange={(event) => setEditPackAmount(event.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label>Container</Label>
								<Select value={editContainer} onValueChange={setEditContainer}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">None</SelectItem>
										<SelectItem value="pet">PET</SelectItem>
										<SelectItem value="limenka">Limenka</SelectItem>
										<SelectItem value="staklo">Staklo</SelectItem>
										<SelectItem value="tetrapak">Tetrapak</SelectItem>
										<SelectItem value="tuba">Tuba</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
						<div className="space-y-1">
							<Label>Search Tags (comma-separated)</Label>
							<Textarea
								value={editSearchTags}
								onChange={(event) => setEditSearchTags(event.target.value)}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setSelectedItem(null)}>
							Cancel
						</Button>
						<Button
							disabled={updateMutation.isPending || !selectedItem}
							onClick={() => {
								if (!selectedItem) {
									return;
								}
								const amount =
									editAmount.trim().length === 0
										? null
										: Number.parseFloat(editAmount);
								const packAmount =
									editPackAmount.trim().length === 0
										? null
										: Number.parseInt(editPackAmount, 10);

								updateMutation.mutate({
									itemId: selectedItem.itemId,
									fields: {
										everydayName:
											editEverydayName.trim().length > 0
												? editEverydayName.trim()
												: null,
										productType:
											editProductType.trim().length > 0
												? editProductType.trim()
												: null,
										brand: editBrand.trim().length > 0 ? editBrand.trim() : null,
										variant:
											editVariant.trim().length > 0 ? editVariant.trim() : null,
										extractedAmount:
											amount != null && Number.isFinite(amount) ? amount : null,
										extractedUnit:
											editUnit === "none"
												? null
												: (editUnit as "g" | "kg" | "ml" | "l" | "kom"),
										packAmount:
											packAmount != null && Number.isFinite(packAmount)
												? packAmount
												: null,
										containerType:
											editContainer === "none"
												? null
												: (editContainer as
														| "pet"
														| "limenka"
														| "staklo"
														| "tetrapak"
														| "tuba"),
										searchTags: editSearchTags
											.split(",")
											.map((tag) => tag.trim())
											.filter((tag) => tag.length > 0),
									},
								});
							}}
						>
							{updateMutation.isPending ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : null}
							Save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function StatCard(props: { label: string; value: number }) {
	return (
		<Card>
			<CardHeader className="pb-2">
				<CardDescription>{props.label}</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="font-semibold text-2xl">{props.value.toLocaleString()}</div>
			</CardContent>
		</Card>
	);
}
