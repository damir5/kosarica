import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Clock,
	Loader2,
	RefreshCw,
	ShieldAlert,
	Trash2,
	Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { TaskQueueRow } from "@/components/admin/task-queue";
import {
	TaskQueueDetailDialog,
	TaskQueueStatsCards,
	TaskStatusBadge,
} from "@/components/admin/task-queue";
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
	DialogDescription,
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
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/task-queue")({
	validateSearch: (search: Record<string, unknown>) => {
		const q = typeof search.search === "string" ? search.search : undefined;
		return q ? { search: q } : {};
	},
	component: TaskQueueDashboard,
});

type StatusFilter =
	| "all"
	| "pending"
	| "claimed"
	| "processing"
	| "completed"
	| "failed"
	| "cancelled"
	| "waiting_for_children";

type TypeFilter = "all" | "ingestion" | "rerun" | "cleanup" | "clickhouse";

type TaskStatus = Exclude<StatusFilter, "all">;
type TaskType = Exclude<TypeFilter, "all">;

type TaskQueueListInput = Parameters<typeof orpc.admin.taskQueue.list.call>[0];

function TaskQueueDashboard() {
	const queryClient = useQueryClient();
	const searchParams = Route.useSearch();
	const searchParam = searchParams.search;
	const [status, setStatus] = useState<StatusFilter>("all");
	const [taskType, setTaskType] = useState<TypeFilter>("all");
	const [workerId, setWorkerId] = useState<string>("");
	const [search, setSearch] = useState<string>(searchParam ?? "");
	const [stuckOnly, setStuckOnly] = useState<boolean>(false);
	const [page, setPage] = useState<number>(1);
	const pageSize = 50;

	const [selectedTask, setSelectedTask] = useState<TaskQueueRow | null>(null);
	const [detailOpen, setDetailOpen] = useState(false);
	const [adminConfirm, setAdminConfirm] = useState<
		null | { type: "recover" } | { type: "cleanup"; daysToKeep: number }
	>(null);

	const listInput = useMemo<TaskQueueListInput>(() => {
		const statusFilter =
			status === "all" ? undefined : ([status] as TaskStatus[]);
		const taskTypeFilter =
			taskType === "all" ? undefined : ([taskType] as TaskType[]);
		return {
			status: statusFilter,
			taskType: taskTypeFilter,
			workerId: workerId.trim().length ? workerId.trim() : undefined,
			search: search.trim().length ? search.trim() : undefined,
			stuckOnly,
			limit: pageSize,
			offset: (page - 1) * pageSize,
			sort: { field: "createdAt", direction: "desc" },
		};
	}, [status, taskType, workerId, search, stuckOnly, page]);

	// If the route search param changes, reflect it in the input box.
	useEffect(() => {
		setSearch(searchParam ?? "");
		setPage(1);
	}, [searchParam]);

	const { data: stats, isLoading: statsLoading } = useQuery(
		orpc.admin.taskQueue.stats.queryOptions({}),
	);

	const listQuery = useQuery({
		...orpc.admin.taskQueue.list.queryOptions({ input: listInput as never }),
		refetchInterval: (query) => {
			const response = query.state.data;
			const hasActive = response?.tasks?.some(
				(t) => t.status === "claimed" || t.status === "processing",
			);
			return hasActive ? 3000 : 30000;
		},
	});

	const hasActiveTasks = listQuery.data?.tasks?.some(
		(t) => t.status === "claimed" || t.status === "processing",
	);

	const invalidateAll = () => {
		queryClient.invalidateQueries({
			queryKey: orpc.admin.taskQueue.key({ type: "query" }),
		});
	};

	const cancelMutation = useMutation({
		mutationFn: async (taskId: string) => {
			return orpc.admin.taskQueue.cancel.call({ taskId });
		},
		onSuccess: () => invalidateAll(),
	});

	const requeueMutation = useMutation({
		mutationFn: async (taskId: string) => {
			return orpc.admin.taskQueue.requeue.call({ taskId, resetRetry: true });
		},
		onSuccess: () => invalidateAll(),
	});

	const rescheduleMutation = useMutation({
		mutationFn: async ({
			taskId,
			scheduledForIso,
		}: {
			taskId: string;
			scheduledForIso: string;
		}) => {
			const scheduledFor = new Date(scheduledForIso);
			if (Number.isNaN(scheduledFor.getTime())) {
				throw new Error("Invalid scheduledFor value");
			}
			return orpc.admin.taskQueue.reschedule.call({ taskId, scheduledFor });
		},
		onSuccess: () => invalidateAll(),
	});

	const recoverMutation = useMutation({
		mutationFn: async () => {
			return orpc.admin.taskQueue.recoverOrphaned.call({});
		},
		onSuccess: () => invalidateAll(),
	});

	const cleanupMutation = useMutation({
		mutationFn: async (daysToKeep: number) => {
			return orpc.admin.taskQueue.cleanupCompleted.call({ daysToKeep });
		},
		onSuccess: () => invalidateAll(),
	});

	const [cleanupDays, setCleanupDays] = useState<string>("7");

	const openTask = (task: TaskQueueRow) => {
		setSelectedTask(task);
		setDetailOpen(true);
	};

	const actionsDisabled =
		cancelMutation.isPending ||
		requeueMutation.isPending ||
		rescheduleMutation.isPending ||
		recoverMutation.isPending ||
		cleanupMutation.isPending;

	return (
		<>
			<div className="border-border border-b bg-card">
				<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
					<div className="flex items-center justify-between gap-4">
						<div className="flex items-center gap-3">
							<Clock className="h-8 w-8 text-primary" />
							<div>
								<h1 className="font-semibold text-2xl text-foreground">
									Task Queue
								</h1>
								<p className="mt-1 text-muted-foreground text-sm">
									Monitor and administer background tasks
								</p>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Button variant="outline" size="icon" onClick={invalidateAll}>
								<RefreshCw
									className={cn("h-4 w-4", hasActiveTasks && "animate-spin")}
								/>
							</Button>
							{hasActiveTasks && (
								<span className="text-xs text-muted-foreground">
									Auto-refreshing
								</span>
							)}
						</div>
					</div>
				</div>
			</div>

			<div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
				{statsLoading ? (
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						Loading stats...
					</div>
				) : (
					<TaskQueueStatsCards stats={stats} />
				)}

				<Card>
					<CardHeader>
						<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
							<div>
								<CardTitle className="flex items-center gap-2">
									<Wrench className="h-5 w-5" />
									Admin Actions
								</CardTitle>
								<CardDescription>
									Recover orphaned tasks and clean up old completed tasks
								</CardDescription>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									variant="outline"
									disabled={actionsDisabled}
									onClick={() => {
										setAdminConfirm({ type: "recover" });
									}}
								>
									{recoverMutation.isPending ? (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									) : (
										<ShieldAlert className="mr-2 h-4 w-4" />
									)}
									Recover Orphaned
								</Button>
								<div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
									<Label htmlFor="cleanupDays" className="text-sm">
										Keep days
									</Label>
									<Input
										id="cleanupDays"
										type="number"
										min={1}
										max={365}
										className="w-[90px]"
										value={cleanupDays}
										onChange={(e) => setCleanupDays(e.target.value)}
										disabled={actionsDisabled}
									/>
									<Button
										variant="outline"
										disabled={
											actionsDisabled ||
											!cleanupDays ||
											Number.isNaN(Number(cleanupDays))
										}
										onClick={() => {
											const days = Number(cleanupDays);
											if (Number.isNaN(days)) return;
											setAdminConfirm({ type: "cleanup", daysToKeep: days });
										}}
									>
										{cleanupMutation.isPending ? (
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										) : (
											<Trash2 className="mr-2 h-4 w-4" />
										)}
										Cleanup Completed
									</Button>
								</div>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex flex-wrap items-center gap-3">
							{recoverMutation.isSuccess && (
								<Badge
									variant="secondary"
									className="bg-green-100 text-green-700"
								>
									Recovered: {recoverMutation.data?.recoveredCount ?? 0},
									Failed: {recoverMutation.data?.failedCount ?? 0}
								</Badge>
							)}
							{cleanupMutation.isSuccess && (
								<Badge
									variant="secondary"
									className="bg-green-100 text-green-700"
								>
									Deleted: {cleanupMutation.data?.deletedCount ?? 0}
								</Badge>
							)}
							{(recoverMutation.isError || cleanupMutation.isError) && (
								<Badge variant="destructive">
									{String(
										(recoverMutation.error ?? cleanupMutation.error)?.message ??
											"Action failed",
									)}
								</Badge>
							)}
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
							<div>
								<CardTitle className="flex items-center gap-2">
									<Clock className="h-5 w-5" />
									Tasks
								</CardTitle>
								<CardDescription>
									Filter and inspect queued work
								</CardDescription>
							</div>
							<div className="flex flex-wrap items-end gap-3">
								<div>
									<Label className="text-xs">Status</Label>
									<Select
										value={status}
										onValueChange={(v) => {
											setStatus(v as StatusFilter);
											setPage(1);
										}}
									>
										<SelectTrigger className="w-[170px]">
											<SelectValue placeholder="Status" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="all">All</SelectItem>
											<SelectItem value="pending">Pending</SelectItem>
											<SelectItem value="claimed">Claimed</SelectItem>
											<SelectItem value="processing">Processing</SelectItem>
											<SelectItem value="completed">Completed</SelectItem>
											<SelectItem value="failed">Failed</SelectItem>
											<SelectItem value="cancelled">Cancelled</SelectItem>
											<SelectItem value="waiting_for_children">
												Waiting for children
											</SelectItem>
										</SelectContent>
									</Select>
								</div>

								<div>
									<Label className="text-xs">Type</Label>
									<Select
										value={taskType}
										onValueChange={(v) => {
											setTaskType(v as TypeFilter);
											setPage(1);
										}}
									>
										<SelectTrigger className="w-[170px]">
											<SelectValue placeholder="Type" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="all">All</SelectItem>
											<SelectItem value="ingestion">Ingestion</SelectItem>
											<SelectItem value="rerun">Rerun</SelectItem>
											<SelectItem value="cleanup">Cleanup</SelectItem>
											<SelectItem value="clickhouse">ClickHouse</SelectItem>
										</SelectContent>
									</Select>
								</div>

								<div>
									<Label className="text-xs">Worker</Label>
									<Input
										className="w-[200px]"
										placeholder="worker id"
										value={workerId}
										onChange={(e) => {
											setWorkerId(e.target.value);
											setPage(1);
										}}
									/>
								</div>

								<div>
									<Label className="text-xs">Search</Label>
									<DebouncedInput
										value={search}
										onChange={(v) => {
											setSearch(String(v));
											setPage(1);
										}}
										debounce={300}
										className="h-10 w-[240px] rounded-md border border-input bg-background px-3 py-2 text-sm"
										placeholder="id, payload, error"
									/>
								</div>

								<div className="flex items-center gap-2 pb-1">
									<Switch
										checked={stuckOnly}
										onCheckedChange={(checked) => {
											setStuckOnly(checked);
											setPage(1);
										}}
									/>
									<span className="text-sm text-muted-foreground">
										Stuck only
									</span>
								</div>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						{listQuery.isLoading ? (
							<div className="flex items-center justify-center py-10 text-muted-foreground">
								<Loader2 className="h-6 w-6 animate-spin" />
							</div>
						) : listQuery.isError ? (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
								{listQuery.error.message}
							</div>
						) : listQuery.data?.tasks?.length ? (
							<>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Status</TableHead>
											<TableHead>Type</TableHead>
											<TableHead>Task ID</TableHead>
											<TableHead>Worker</TableHead>
											<TableHead>Retry</TableHead>
											<TableHead>Scheduled</TableHead>
											<TableHead>Updated</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{listQuery.data.tasks.map((t) => (
											<TableRow
												key={t.id}
												className="cursor-pointer"
												onClick={() => openTask(t as TaskQueueRow)}
											>
												<TableCell>
													<TaskStatusBadge status={t.status} />
												</TableCell>
												<TableCell className="font-mono text-xs">
													{t.taskType}
												</TableCell>
												<TableCell className="font-mono text-xs">
													{t.id}
												</TableCell>
												<TableCell className="font-mono text-xs">
													{t.workerId ?? "-"}
												</TableCell>
												<TableCell className="font-mono text-xs">
													{String(t.retryCount ?? 0)}/
													{String(t.maxRetries ?? 0)}
												</TableCell>
												<TableCell className="text-xs text-muted-foreground">
													{t.scheduledFor
														? new Date(t.scheduledFor).toLocaleString()
														: "-"}
												</TableCell>
												<TableCell className="text-xs text-muted-foreground">
													{t.updatedAt
														? new Date(t.updatedAt).toLocaleString()
														: "-"}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>

								<div className="mt-4 flex items-center justify-between">
									<p className="text-sm text-muted-foreground">
										Showing {(page - 1) * pageSize + 1} to{" "}
										{Math.min(page * pageSize, listQuery.data.total)} of{" "}
										{listQuery.data.total} tasks
									</p>
									<div className="flex items-center gap-2">
										<Button
											variant="outline"
											disabled={page === 1}
											onClick={() => setPage((p) => Math.max(1, p - 1))}
										>
											Prev
										</Button>
										<Button
											variant="outline"
											disabled={page * pageSize >= listQuery.data.total}
											onClick={() => setPage((p) => p + 1)}
										>
											Next
										</Button>
									</div>
								</div>
							</>
						) : (
							<div className="py-10 text-center text-muted-foreground">
								No tasks found
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			<TaskQueueDetailDialog
				open={detailOpen}
				onOpenChange={setDetailOpen}
				task={selectedTask}
				actionsDisabled={actionsDisabled}
				onCancel={(taskId) => cancelMutation.mutate(taskId)}
				onRequeue={(taskId) => requeueMutation.mutate(taskId)}
				onReschedule={(taskId, scheduledForIso) =>
					rescheduleMutation.mutate({ taskId, scheduledForIso })
				}
			/>

			{adminConfirm && (
				<Dialog
					open={true}
					onOpenChange={() => {
						setAdminConfirm(null);
					}}
				>
					<DialogContent className="sm:max-w-lg">
						<DialogHeader>
							<DialogTitle>Confirm Admin Action</DialogTitle>
							<DialogDescription>
								{adminConfirm.type === "recover" && (
									<>
										Recover orphaned tasks? This will reset stuck
										claimed/processing tasks back to pending.
									</>
								)}
								{adminConfirm.type === "cleanup" && (
									<>
										Delete completed tasks older than {adminConfirm.daysToKeep}{" "}
										day(s)? This cannot be undone.
									</>
								)}
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button
								variant="outline"
								onClick={() => setAdminConfirm(null)}
								disabled={actionsDisabled}
							>
								Back
							</Button>
							<Button
								variant={
									adminConfirm.type === "cleanup" ? "destructive" : "default"
								}
								disabled={actionsDisabled}
								onClick={() => {
									const action = adminConfirm;
									setAdminConfirm(null);
									if (action.type === "recover") {
										recoverMutation.mutate();
										return;
									}
									cleanupMutation.mutate(action.daysToKeep);
								}}
							>
								Confirm
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}
