import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/llm-decisions")({
	component: AdminLlmDecisionsPage,
});

type ListInput = Parameters<typeof orpc.admin.llmDecisions.list.call>[0];

function AdminLlmDecisionsPage() {
	const queryClient = useQueryClient();
	const [taskType, setTaskType] = useState("");
	const [modelId, setModelId] = useState("");
	const [verdict, setVerdict] = useState("");
	const [selectedDecisionId, setSelectedDecisionId] = useState("");
	const [overrideVerdict, setOverrideVerdict] = useState("");
	const [overrideNotes, setOverrideNotes] = useState("");

	const listInput = useMemo<ListInput>(
		() => ({
			taskType: taskType.trim() || undefined,
			modelId: modelId.trim() || undefined,
			verdict: verdict.trim() || undefined,
			limit: 80,
			offset: 0,
		}),
		[taskType, modelId, verdict],
	);

	const listQuery = useQuery(
		orpc.admin.llmDecisions.list.queryOptions({
			input: listInput,
		}),
	);
	const statsQuery = useQuery(
		orpc.admin.llmDecisions.stats.queryOptions({
			input: {},
		}),
	);
	const selectedId = selectedDecisionId || listQuery.data?.items[0]?.id || "";
	const detailQuery = useQuery({
		...orpc.admin.llmDecisions.get.queryOptions({
			input: { decisionId: selectedId },
		}),
		enabled: selectedId.length > 0,
	});

	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: orpc.admin.llmDecisions.key({ type: "query" }),
		});
	};

	const overrideMutation = useMutation({
		mutationFn: (
			payload: Parameters<typeof orpc.admin.llmDecisions.override.call>[0],
		) => orpc.admin.llmDecisions.override.call(payload),
		onSuccess: () => {
			setOverrideVerdict("");
			setOverrideNotes("");
			invalidate();
		},
	});
	const listErrorMessage =
		listQuery.error instanceof Error
			? listQuery.error.message
			: "Failed to load LLM decisions";
	const statsErrorMessage =
		statsQuery.error instanceof Error
			? statsQuery.error.message
			: "Failed to load LLM decision stats";
	const detailErrorMessage =
		detailQuery.error instanceof Error
			? detailQuery.error.message
			: "Failed to load decision detail";
	const overrideErrorMessage =
		overrideMutation.error instanceof Error
			? overrideMutation.error.message
			: "Failed to apply override";

	return (
		<div className="mx-auto max-w-7xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-semibold text-2xl">LLM Decisions</h1>
					<p className="text-muted-foreground text-sm">
						Inspect model outputs and apply reviewer overrides.
					</p>
				</div>
				<Button variant="outline" onClick={invalidate}>
					<RefreshCw className="mr-2 h-4 w-4" />
					Refresh
				</Button>
			</div>

			<div className="grid gap-3 md:grid-cols-3">
				<Card>
					<CardHeader>
						<CardTitle>Total Calls</CardTitle>
					</CardHeader>
					<CardContent className="text-2xl">{statsQuery.data?.total ?? 0}</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>Avg Latency</CardTitle>
					</CardHeader>
					<CardContent className="text-2xl">
						{Math.round(statsQuery.data?.avgLatencyMs ?? 0)} ms
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>Total Cost</CardTitle>
					</CardHeader>
					<CardContent className="text-2xl">
						{((statsQuery.data?.totalCostCents ?? 0) / 100).toFixed(2)} €
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Filters</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-2 md:grid-cols-3">
					<Input
						placeholder="Task type"
						value={taskType}
						onChange={(event) => setTaskType(event.target.value)}
					/>
					<Input
						placeholder="Model id"
						value={modelId}
						onChange={(event) => setModelId(event.target.value)}
					/>
					<Input
						placeholder="Verdict"
						value={verdict}
						onChange={(event) => setVerdict(event.target.value)}
					/>
				</CardContent>
			</Card>
			{statsQuery.isError ? (
				<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
					{statsErrorMessage}
				</div>
			) : null}
			{overrideMutation.isError ? (
				<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
					{overrideErrorMessage}
				</div>
			) : null}

			<div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
				<Card>
					<CardHeader>
						<CardTitle>Recent Decisions</CardTitle>
					</CardHeader>
					<CardContent>
						{listQuery.isLoading ? (
							<div className="flex items-center gap-2 text-muted-foreground text-sm">
								<Loader2 className="h-4 w-4 animate-spin" />
								Loading...
							</div>
						) : listQuery.isError ? (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
								{listErrorMessage}
							</div>
						) : (
							<div className="overflow-x-auto">
								<table className="min-w-full text-sm">
									<thead>
										<tr className="border-b text-left">
											<th className="px-2 py-1">Time</th>
											<th className="px-2 py-1">Task</th>
											<th className="px-2 py-1">Model</th>
											<th className="px-2 py-1">Verdict</th>
											<th className="px-2 py-1">Confidence</th>
											<th className="px-2 py-1">Latency</th>
										</tr>
									</thead>
									<tbody>
										{(listQuery.data?.items ?? []).map((item) => (
											<tr
												key={item.id}
												className={`cursor-pointer border-b ${
													item.id === selectedId ? "bg-primary/5" : ""
												}`}
												onClick={() => setSelectedDecisionId(item.id)}
											>
												<td className="px-2 py-1">
													{new Date(item.createdAt).toLocaleString()}
												</td>
												<td className="px-2 py-1">{item.taskType}</td>
												<td className="px-2 py-1">{item.modelId}</td>
												<td className="px-2 py-1">{item.verdict ?? "-"}</td>
												<td className="px-2 py-1">
													{item.confidence == null
														? "-"
														: item.confidence.toFixed(2)}
												</td>
												<td className="px-2 py-1">{item.latencyMs ?? "-"}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Decision Detail</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						{detailQuery.isLoading ? (
							<div className="flex items-center gap-2 text-muted-foreground text-sm">
								<Loader2 className="h-4 w-4 animate-spin" />
								Loading detail...
							</div>
						) : detailQuery.isError ? (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
								{detailErrorMessage}
							</div>
						) : detailQuery.data ? (
							<>
								<div className="space-y-1 text-sm">
									<div>Task: {detailQuery.data.taskType}</div>
									<div>Provider: {detailQuery.data.provider}</div>
									<div>Model: {detailQuery.data.modelId}</div>
									<div>Verdict: {detailQuery.data.verdict ?? "-"}</div>
									<div>
										Confidence:{" "}
										{detailQuery.data.confidence == null
											? "-"
											: detailQuery.data.confidence.toFixed(2)}
									</div>
								</div>

								<div>
									<Label>Input JSON</Label>
									<pre className="max-h-40 overflow-auto rounded-md border bg-muted p-2 text-xs">
										{JSON.stringify(detailQuery.data.input, null, 2)}
									</pre>
								</div>
								<div>
									<Label>Output JSON</Label>
									<pre className="max-h-40 overflow-auto rounded-md border bg-muted p-2 text-xs">
										{JSON.stringify(detailQuery.data.output, null, 2)}
									</pre>
								</div>

								<div className="space-y-2 rounded-md border p-3">
									<Label>Override Verdict</Label>
									<Input
										placeholder="e.g. EXACT_MATCH"
										value={overrideVerdict}
										onChange={(event) =>
											setOverrideVerdict(event.target.value)
										}
									/>
									<Label>Notes</Label>
									<Textarea
										value={overrideNotes}
										onChange={(event) => setOverrideNotes(event.target.value)}
									/>
									<Button
										onClick={() => {
											if (!selectedId || !overrideVerdict.trim()) return;
											overrideMutation.mutate({
												decisionId: selectedId,
												humanOverride: overrideVerdict.trim(),
												humanNotes: overrideNotes.trim() || undefined,
											});
										}}
										disabled={overrideMutation.isPending || !selectedId}
									>
										Apply Override
									</Button>
								</div>
							</>
						) : (
							<div className="text-muted-foreground text-sm">No decision selected.</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
