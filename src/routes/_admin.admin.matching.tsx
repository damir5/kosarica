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

function AdminMatchingPage() {
	const queryClient = useQueryClient();

	const [pairwiseMaxBatches, setPairwiseMaxBatches] = useState<string>("10");
	const [pairwiseFeatureBatchSize, setPairwiseFeatureBatchSize] =
		useState<string>("");
	const [
		pairwiseEmbeddingBackfillBatchSize,
		setPairwiseEmbeddingBackfillBatchSize,
	] = useState<string>("");
	const [pairwiseCandidateSourceBatch, setPairwiseCandidateSourceBatch] =
		useState<string>("");
	const [pairwiseCandidateInsertLimit, setPairwiseCandidateInsertLimit] =
		useState<string>("");
	const [pairwiseAdjudicationBatchSize, setPairwiseAdjudicationBatchSize] =
		useState<string>("");
	const [pairwiseLlmPromptBatchSize, setPairwiseLlmPromptBatchSize] =
		useState<string>("");
	const [pairwiseRebuildClusters, setPairwiseRebuildClusters] =
		useState<boolean>(false);

	const [listwiseLimit, setListwiseLimit] = useState<string>("200");
	const [listwiseMinChains, setListwiseMinChains] = useState<string>("2");
	const [listwiseDryRun, setListwiseDryRun] = useState<boolean>(true);
	const [listwiseMinPrimaryConfidence, setListwiseMinPrimaryConfidence] =
		useState<string>("0.8");
	const [listwisePrimaryModelId, setListwisePrimaryModelId] =
		useState<string>("");
	const [listwiseSecondaryModelId, setListwiseSecondaryModelId] =
		useState<string>("");

	const invalidateTaskQueue = () => {
		queryClient.invalidateQueries({
			queryKey: orpc.admin.taskQueue.key({ type: "query" }),
		});
	};

	const pairwiseInput = useMemo<
		Parameters<
			typeof orpc.admin.matching.triggerPairwiseSemanticClustering.call
		>[0]
	>(() => {
		const toInt = (value: string): number | undefined => {
			if (value.trim().length === 0) return undefined;
			const n = Number.parseInt(value, 10);
			return Number.isFinite(n) ? n : undefined;
		};

		return {
			maxBatches: toInt(pairwiseMaxBatches),
			featureBatchSize: toInt(pairwiseFeatureBatchSize),
			embeddingBackfillBatchSize: toInt(pairwiseEmbeddingBackfillBatchSize),
			candidateSourceBatch: toInt(pairwiseCandidateSourceBatch),
			candidateInsertLimit: toInt(pairwiseCandidateInsertLimit),
			adjudicationBatchSize: toInt(pairwiseAdjudicationBatchSize),
			llmPromptBatchSize: toInt(pairwiseLlmPromptBatchSize),
			rebuildClusters: pairwiseRebuildClusters,
		};
	}, [
		pairwiseAdjudicationBatchSize,
		pairwiseCandidateInsertLimit,
		pairwiseCandidateSourceBatch,
		pairwiseEmbeddingBackfillBatchSize,
		pairwiseFeatureBatchSize,
		pairwiseLlmPromptBatchSize,
		pairwiseMaxBatches,
		pairwiseRebuildClusters,
	]);

	const listwiseInput = useMemo<
		Parameters<
			typeof orpc.admin.matching.triggerListwiseSemanticClustering.call
		>[0]
	>(() => {
		const toInt = (value: string): number | undefined => {
			if (value.trim().length === 0) return undefined;
			const n = Number.parseInt(value, 10);
			return Number.isFinite(n) ? n : undefined;
		};
		const toFloat = (value: string): number | undefined => {
			if (value.trim().length === 0) return undefined;
			const n = Number.parseFloat(value);
			return Number.isFinite(n) ? n : undefined;
		};

		return {
			limit: toInt(listwiseLimit),
			minChains: toInt(listwiseMinChains),
			dryRun: listwiseDryRun,
			minPrimaryConfidence: toFloat(listwiseMinPrimaryConfidence),
			primaryModelId: listwisePrimaryModelId.trim() || undefined,
			secondaryModelId: listwiseSecondaryModelId.trim() || undefined,
		};
	}, [
		listwiseDryRun,
		listwiseLimit,
		listwiseMinChains,
		listwiseMinPrimaryConfidence,
		listwisePrimaryModelId,
		listwiseSecondaryModelId,
	]);

	const pairwiseMutation = useMutation({
		mutationFn: async () => {
			return orpc.admin.matching.triggerPairwiseSemanticClustering.call(
				pairwiseInput,
			);
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
							Enqueue semantic clustering tasks (pairwise / listwise).
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Button
						asChild
						variant="outline"
						disabled={pairwiseMutation.isPending || listwiseMutation.isPending}
					>
						<Link to="/admin/task-queue" search={{ search: "matching" }}>
							Task Queue
						</Link>
					</Button>
					<Button
						variant="outline"
						onClick={() => invalidateTaskQueue()}
						disabled={pairwiseMutation.isPending || listwiseMutation.isPending}
					>
						<RefreshCw className="mr-2 h-4 w-4" />
						Refresh Task Queue
					</Button>
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Listwise Semantic Clustering</CardTitle>
						<CardDescription>
							Enqueues a single task that runs the listwise pipeline.
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
							<div className="space-y-1 md:col-span-2">
								<Label htmlFor="listwisePrimaryModelId">Primary model id</Label>
								<Input
									id="listwisePrimaryModelId"
									placeholder="(optional)"
									value={listwisePrimaryModelId}
									onChange={(e) => setListwisePrimaryModelId(e.target.value)}
								/>
							</div>
							<div className="space-y-1 md:col-span-2">
								<Label htmlFor="listwiseSecondaryModelId">
									Secondary model id
								</Label>
								<Input
									id="listwiseSecondaryModelId"
									placeholder="(optional)"
									value={listwiseSecondaryModelId}
									onChange={(e) => setListwiseSecondaryModelId(e.target.value)}
								/>
							</div>
						</div>

						<div className="flex flex-wrap items-center gap-2">
							<Button
								onClick={() => listwiseMutation.mutate()}
								disabled={
									listwiseMutation.isPending || pairwiseMutation.isPending
								}
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

				<Card>
					<CardHeader>
						<CardTitle>Pairwise Semantic Clustering</CardTitle>
						<CardDescription>
							Enqueues a task that runs batches until no more work remains.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 md:grid-cols-2">
							<div className="space-y-1">
								<Label htmlFor="pairwiseMaxBatches">Max batches</Label>
								<Input
									id="pairwiseMaxBatches"
									type="number"
									min={1}
									max={50}
									value={pairwiseMaxBatches}
									onChange={(e) => setPairwiseMaxBatches(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label>Rebuild clusters</Label>
								<div className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3">
									<Switch
										checked={pairwiseRebuildClusters}
										onCheckedChange={setPairwiseRebuildClusters}
									/>
									<span className="text-muted-foreground text-sm">
										{pairwiseRebuildClusters ? "Enabled" : "Disabled"}
									</span>
								</div>
							</div>
							<div className="space-y-1">
								<Label htmlFor="pairwiseFeatureBatchSize">
									Feature batch size
								</Label>
								<Input
									id="pairwiseFeatureBatchSize"
									type="number"
									min={1}
									max={50000}
									placeholder="(optional)"
									value={pairwiseFeatureBatchSize}
									onChange={(e) => setPairwiseFeatureBatchSize(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="pairwiseEmbeddingBackfillBatchSize">
									Embedding backfill batch size
								</Label>
								<Input
									id="pairwiseEmbeddingBackfillBatchSize"
									type="number"
									min={1}
									max={50000}
									placeholder="(optional)"
									value={pairwiseEmbeddingBackfillBatchSize}
									onChange={(e) =>
										setPairwiseEmbeddingBackfillBatchSize(e.target.value)
									}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="pairwiseCandidateSourceBatch">
									Candidate source batch
								</Label>
								<Input
									id="pairwiseCandidateSourceBatch"
									type="number"
									min={1}
									max={50000}
									placeholder="(optional)"
									value={pairwiseCandidateSourceBatch}
									onChange={(e) =>
										setPairwiseCandidateSourceBatch(e.target.value)
									}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="pairwiseCandidateInsertLimit">
									Candidate insert limit
								</Label>
								<Input
									id="pairwiseCandidateInsertLimit"
									type="number"
									min={1}
									max={200000}
									placeholder="(optional)"
									value={pairwiseCandidateInsertLimit}
									onChange={(e) =>
										setPairwiseCandidateInsertLimit(e.target.value)
									}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="pairwiseAdjudicationBatchSize">
									Adjudication batch size
								</Label>
								<Input
									id="pairwiseAdjudicationBatchSize"
									type="number"
									min={1}
									max={10000}
									placeholder="(optional)"
									value={pairwiseAdjudicationBatchSize}
									onChange={(e) =>
										setPairwiseAdjudicationBatchSize(e.target.value)
									}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="pairwiseLlmPromptBatchSize">
									LLM prompt batch size
								</Label>
								<Input
									id="pairwiseLlmPromptBatchSize"
									type="number"
									min={1}
									max={200}
									placeholder="(optional)"
									value={pairwiseLlmPromptBatchSize}
									onChange={(e) =>
										setPairwiseLlmPromptBatchSize(e.target.value)
									}
								/>
							</div>
						</div>

						<div className="flex flex-wrap items-center gap-2">
							<Button
								onClick={() => pairwiseMutation.mutate()}
								disabled={
									pairwiseMutation.isPending || listwiseMutation.isPending
								}
							>
								{pairwiseMutation.isPending ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : null}
								Enqueue pairwise task
							</Button>
							{pairwiseMutation.isSuccess && pairwiseMutation.data?.queued ? (
								<Badge
									variant="secondary"
									className="bg-green-100 text-green-700"
								>
									Queued: {pairwiseMutation.data.taskId}
								</Badge>
							) : null}
						</div>
						{pairwiseMutation.isError ? (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
								{errorMessage(
									pairwiseMutation.error,
									"Failed to enqueue pairwise task",
								)}
							</div>
						) : null}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
