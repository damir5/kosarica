import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Layers, Loader2, RefreshCw } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/matching")({
	component: AdminMatchingPage,
});

function parseOptionalInt(value: string): number | undefined {
	if (value.trim().length === 0) return undefined;
	const n = Number.parseInt(value, 10);
	return Number.isFinite(n) ? n : undefined;
}

function parseOptionalFloat(value: string): number | undefined {
	if (value.trim().length === 0) return undefined;
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? n : undefined;
}

function AdminMatchingPage() {
	const queryClient = useQueryClient();

	// Unified matching state
	const [unifiedLimit, setUnifiedLimit] = useState<string>("50");
	const [unifiedDryRun, setUnifiedDryRun] = useState<boolean>(true);
	const [unifiedMinPrimaryConfidence, setUnifiedMinPrimaryConfidence] =
		useState<string>("0.8");
	const [unifiedGroupsPerCall, setUnifiedGroupsPerCall] =
		useState<string>("3");

	// Unified matching blocking options state
	const [unifiedBarcodeLimit, setUnifiedBarcodeLimit] = useState<string>("");
	const [unifiedBarcodeMinChains, setUnifiedBarcodeMinChains] =
		useState<string>("2");
	const [unifiedDeterministicLimit, setUnifiedDeterministicLimit] =
		useState<string>("");
	const [unifiedEmbeddingLimit, setUnifiedEmbeddingLimit] =
		useState<string>("");
	const [unifiedLexicalLimit, setUnifiedLexicalLimit] = useState<string>("");

	// Listwise state
	const [listwiseLimit, setListwiseLimit] = useState<string>("200");
	const [listwiseMinChains, setListwiseMinChains] = useState<string>("2");
	const [listwiseDryRun, setListwiseDryRun] = useState<boolean>(true);
	const [listwiseMinPrimaryConfidence, setListwiseMinPrimaryConfidence] =
		useState<string>("0.8");

	const invalidateTaskQueue = () => {
		queryClient.invalidateQueries({
			queryKey: orpc.admin.taskQueue.key({ type: "query" }),
		});
	};

	const unifiedInput = useMemo<
		Parameters<typeof orpc.admin.matching.triggerUnifiedMatching.call>[0]
	>(
		() => ({
			limit: parseOptionalInt(unifiedLimit),
			dryRun: unifiedDryRun,
			minPrimaryConfidence: parseOptionalFloat(unifiedMinPrimaryConfidence),
			groupsPerCall: parseOptionalInt(unifiedGroupsPerCall),
			blocking: {
				barcodeLimit: parseOptionalInt(unifiedBarcodeLimit),
				barcodeMinChains: parseOptionalInt(unifiedBarcodeMinChains),
				deterministicLimit: parseOptionalInt(unifiedDeterministicLimit),
				embeddingLimit: parseOptionalInt(unifiedEmbeddingLimit),
				lexicalLimit: parseOptionalInt(unifiedLexicalLimit),
			},
		}),
		[
			unifiedDryRun,
			unifiedLimit,
			unifiedMinPrimaryConfidence,
			unifiedGroupsPerCall,
			unifiedBarcodeLimit,
			unifiedBarcodeMinChains,
			unifiedDeterministicLimit,
			unifiedEmbeddingLimit,
			unifiedLexicalLimit,
		],
	);

	const listwiseInput = useMemo<
		Parameters<
			typeof orpc.admin.matching.triggerListwiseSemanticClustering.call
		>[0]
		>(
		() => ({
			limit: parseOptionalInt(listwiseLimit),
			minChains: parseOptionalInt(listwiseMinChains),
			dryRun: listwiseDryRun,
			minPrimaryConfidence: parseOptionalFloat(listwiseMinPrimaryConfidence),
		}),
		[
			listwiseDryRun,
			listwiseLimit,
			listwiseMinChains,
			listwiseMinPrimaryConfidence,
		],
	);

	const unifiedMutation = useMutation({
		mutationFn: async () => {
			return orpc.admin.matching.triggerUnifiedMatching.call(unifiedInput);
		},
		onSuccess: () => invalidateTaskQueue(),
	});

	const listwiseMutation = useMutation({
		mutationFn: async () => {
			return orpc.admin.matching.triggerListwiseSemanticClustering.call(
				listwiseInput,
			);
		},
		onSuccess: () => invalidateTaskQueue(),
	});

	const anyPending =
		unifiedMutation.isPending || listwiseMutation.isPending;

	const errorMessage = (error: unknown, fallback: string) => {
		return error instanceof Error ? error.message : fallback;
	};

	return (
		<div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<Layers className="h-8 w-8 text-primary" />
					<div>
						<h1 className="font-semibold text-2xl">Matching</h1>
						<p className="text-muted-foreground text-sm">
							Enqueue matching tasks (unified / listwise).
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Button asChild variant="outline" disabled={anyPending}>
						<Link to="/admin/task-queue" search={{ search: "matching" }}>
							Task Queue
						</Link>
					</Button>
					<Button
						variant="outline"
						onClick={() => invalidateTaskQueue()}
						disabled={anyPending}
					>
						<RefreshCw className="mr-2 h-4 w-4" />
						Refresh Task Queue
					</Button>
				</div>
			</div>

			{/* Unified matching — primary */}
			<Card className="border-primary/30">
				<CardHeader>
					<CardTitle>Unified Matching</CardTitle>
					<CardDescription>
						Multi-strategy blocking (barcode + deterministic + embedding +
						lexical) with listwise LLM resolution. Recommended pipeline.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-3 md:grid-cols-4">
						<div className="space-y-1">
							<Label htmlFor="unifiedLimit">Group limit</Label>
							<Input
								id="unifiedLimit"
								type="number"
								min={1}
								max={500}
								value={unifiedLimit}
								onChange={(e) => setUnifiedLimit(e.target.value)}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="unifiedGroupsPerCall">Groups per call</Label>
							<Input
								id="unifiedGroupsPerCall"
								type="number"
								min={1}
								max={20}
								value={unifiedGroupsPerCall}
								onChange={(e) => setUnifiedGroupsPerCall(e.target.value)}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="unifiedMinPrimaryConfidence">
								Min primary confidence
							</Label>
							<Input
								id="unifiedMinPrimaryConfidence"
								type="number"
								min={0}
								max={1}
								step={0.01}
								value={unifiedMinPrimaryConfidence}
								onChange={(e) =>
									setUnifiedMinPrimaryConfidence(e.target.value)
								}
							/>
						</div>
						<div className="space-y-1">
							<Label>Dry run</Label>
							<div className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3">
								<Switch
									checked={unifiedDryRun}
									onCheckedChange={setUnifiedDryRun}
								/>
								<span className="text-muted-foreground text-sm">
									{unifiedDryRun ? "Enabled" : "Disabled"}
								</span>
							</div>
						</div>
					</div>

					{/* Blocking options */}
					<div className="space-y-1">
						<Label className="text-muted-foreground text-xs uppercase tracking-wide">
							Blocking limits
						</Label>
						<div className="grid gap-3 md:grid-cols-5">
							<div className="space-y-1">
								<Label htmlFor="unifiedBarcodeLimit" className="text-xs">
									Barcode
								</Label>
								<Input
									id="unifiedBarcodeLimit"
									type="number"
									min={1}
									max={1000}
									placeholder="(default)"
									value={unifiedBarcodeLimit}
									onChange={(e) => setUnifiedBarcodeLimit(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="unifiedBarcodeMinChains" className="text-xs">
									Min chains
								</Label>
								<Input
									id="unifiedBarcodeMinChains"
									type="number"
									min={1}
									max={20}
									value={unifiedBarcodeMinChains}
									onChange={(e) => setUnifiedBarcodeMinChains(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="unifiedDeterministicLimit" className="text-xs">
									Det.
								</Label>
								<Input
									id="unifiedDeterministicLimit"
									type="number"
									min={1}
									max={1000}
									placeholder="(default)"
									value={unifiedDeterministicLimit}
									onChange={(e) => setUnifiedDeterministicLimit(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="unifiedEmbeddingLimit" className="text-xs">
									Embed
								</Label>
								<Input
									id="unifiedEmbeddingLimit"
									type="number"
									min={1}
									max={500}
									placeholder="(default)"
									value={unifiedEmbeddingLimit}
									onChange={(e) => setUnifiedEmbeddingLimit(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="unifiedLexicalLimit" className="text-xs">
									Lexical
								</Label>
								<Input
									id="unifiedLexicalLimit"
									type="number"
									min={1}
									max={500}
									placeholder="(default)"
									value={unifiedLexicalLimit}
									onChange={(e) => setUnifiedLexicalLimit(e.target.value)}
								/>
							</div>
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<Button
							onClick={() => unifiedMutation.mutate()}
							disabled={anyPending}
						>
							{unifiedMutation.isPending ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : null}
							Run Matching
						</Button>
						{unifiedMutation.isSuccess && unifiedMutation.data?.queued ? (
							<Badge
								variant="secondary"
								className="bg-green-100 text-green-700"
							>
								Queued: {unifiedMutation.data.taskId}
							</Badge>
						) : null}
					</div>
					{unifiedMutation.isError ? (
						<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
							{errorMessage(
								unifiedMutation.error,
								"Failed to enqueue unified task",
							)}
						</div>
					) : null}
				</CardContent>
			</Card>

			{/* Legacy pipelines */}
			<div className="grid gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Listwise Semantic Clustering</CardTitle>
						<CardDescription>
							Barcode-seeded groups only. Legacy pipeline.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 md:grid-cols-2">
							<div className="space-y-1">
								<Label htmlFor="listwiseLimit">Limit</Label>
								<Input
									id="listwiseLimit"
									type="number"
									min={1}
									max={500}
									value={listwiseLimit}
									onChange={(e) => setListwiseLimit(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="listwiseMinChains">Min chains</Label>
								<Input
									id="listwiseMinChains"
									type="number"
									min={1}
									max={20}
									value={listwiseMinChains}
									onChange={(e) => setListwiseMinChains(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="listwiseMinPrimaryConfidence">
									Min primary confidence
								</Label>
								<Input
									id="listwiseMinPrimaryConfidence"
									type="number"
									min={0}
									max={1}
									step={0.01}
									value={listwiseMinPrimaryConfidence}
									onChange={(e) =>
										setListwiseMinPrimaryConfidence(e.target.value)
									}
								/>
							</div>
							<div className="space-y-1">
								<Label>Dry run</Label>
								<div className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3">
									<Switch
										checked={listwiseDryRun}
										onCheckedChange={setListwiseDryRun}
									/>
									<span className="text-muted-foreground text-sm">
										{listwiseDryRun ? "Enabled" : "Disabled"}
									</span>
								</div>
							</div>
						</div>

						<div className="flex flex-wrap items-center gap-2">
							<Button
								onClick={() => listwiseMutation.mutate()}
								disabled={anyPending}
							>
								{listwiseMutation.isPending ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : null}
								Enqueue listwise task
							</Button>
							{listwiseMutation.isSuccess && listwiseMutation.data?.queued ? (
								<Badge
									variant="secondary"
									className="bg-green-100 text-green-700"
								>
									Queued: {listwiseMutation.data.taskId}
								</Badge>
							) : null}
						</div>
						{listwiseMutation.isError ? (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
								{errorMessage(
									listwiseMutation.error,
									"Failed to enqueue listwise task",
								)}
							</div>
						) : null}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
