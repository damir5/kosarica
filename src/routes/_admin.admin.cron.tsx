import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Activity,
	CheckCircle,
	ChevronLeft,
	ChevronRight,
	Clock,
	Loader2,
	Pause,
	Play,
	RefreshCw,
	XCircle,
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/cron" as any)({
	component: CronDashboard,
});

function CronDashboard() {
	const queryClient = useQueryClient();
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [page, setPage] = useState(1);
	const pageSize = 20;

	// Health query
	const { data: health, isLoading: healthLoading } = useQuery(
		orpc.admin.cron.health.queryOptions({}),
	);

	// Jobs list query
	const { data: jobs, isLoading: jobsLoading } = useQuery(
		orpc.admin.cron.list.queryOptions({}),
	);

	// Runs query with smart auto-refresh
	const { data: runsData, isLoading: runsLoading } = useQuery({
		...orpc.admin.cron.listRuns.queryOptions({
			input: {
				status: statusFilter !== "all" ? (statusFilter as any) : undefined,
				limit: pageSize,
				offset: (page - 1) * pageSize,
			},
		}),
		refetchInterval: (query) => {
			const response = query.state.data;
			const hasActiveRuns = response?.runs?.some(
				(run) => run.status === "running",
			);
			return hasActiveRuns ? 3000 : 30000;
		},
	});

	// Toggle mutation
	const toggleMutation = useMutation({
		mutationFn: async ({
			jobId,
			enabled,
		}: { jobId: string; enabled: boolean }) => {
			return orpc.admin.cron.toggle.call({ jobId, enabled });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "cron"] });
		},
	});

	// Trigger mutation
	const triggerMutation = useMutation({
		mutationFn: async (jobId: string) => {
			return orpc.admin.cron.trigger.call({ jobId });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "cron"] });
		},
	});

	const handleRefresh = () => {
		queryClient.invalidateQueries({ queryKey: ["admin", "cron"] });
	};

	const hasActiveRuns = runsData?.runs?.some((run) => run.status === "running");

	return (
		<>
			{/* Header */}
			<div className="border-border border-b bg-card">
				<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<Clock className="h-8 w-8 text-primary" />
							<div>
								<h1 className="font-semibold text-2xl text-foreground">
									Cron Jobs
								</h1>
								<p className="mt-1 text-muted-foreground text-sm">
									Manage scheduled tasks and view execution history
								</p>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Button variant="outline" size="icon" onClick={handleRefresh}>
								<RefreshCw
									className={`h-4 w-4 ${hasActiveRuns ? "animate-spin" : ""}`}
								/>
							</Button>
							{hasActiveRuns && (
								<span className="text-xs text-muted-foreground">
									Auto-refreshing
								</span>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* Main Content */}
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
				{/* Health Stats */}
				<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">
								Scheduler Status
							</CardTitle>
						</CardHeader>
						<CardContent>
							{healthLoading ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<div className="flex items-center gap-2">
									{health?.scheduler.isRunning ? (
										<>
											<CheckCircle className="h-5 w-5 text-green-500" />
											<span className="font-semibold text-green-600">
												Running
											</span>
										</>
									) : (
										<>
											<XCircle className="h-5 w-5 text-red-500" />
											<span className="font-semibold text-red-600">
												Stopped
											</span>
										</>
									)}
									{health?.scheduler.isLeader && (
										<Badge variant="secondary" className="ml-2">
											Leader
										</Badge>
									)}
								</div>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">
								Active Jobs
							</CardTitle>
						</CardHeader>
						<CardContent>
							{healthLoading ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<p className="font-semibold text-2xl">
									{health?.jobs.enabled ?? 0}
									<span className="text-muted-foreground text-sm font-normal">
										{" "}
										/ {health?.jobs.total ?? 0}
									</span>
								</p>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">
								Runs (24h)
							</CardTitle>
						</CardHeader>
						<CardContent>
							{healthLoading ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<p className="font-semibold text-2xl">
									{health?.recentRuns.total ?? 0}
								</p>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">
								Success Rate (24h)
							</CardTitle>
						</CardHeader>
						<CardContent>
							{healthLoading ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<p className="font-semibold text-2xl">
									{health?.recentRuns.total
										? Math.round(
												((health.recentRuns.completed ?? 0) /
													health.recentRuns.total) *
													100,
											)
										: 0}
									%
								</p>
							)}
						</CardContent>
					</Card>
				</div>

				{/* Jobs List */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Clock className="h-5 w-5" />
							Scheduled Jobs
						</CardTitle>
						<CardDescription>
							Configure and trigger cron jobs
						</CardDescription>
					</CardHeader>
					<CardContent>
						{jobsLoading ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
							</div>
						) : jobs && jobs.length > 0 ? (
							<div className="divide-y divide-border">
								{jobs.map((job) => (
									<div
										key={job.id}
										className="py-4 flex items-center justify-between"
									>
										<div className="flex-1">
											<div className="flex items-center gap-2">
												<span className="font-medium">{job.name}</span>
												{!job.hasHandler && (
													<Badge variant="destructive" className="text-xs">
														No Handler
													</Badge>
												)}
											</div>
											<div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
												<span className="font-mono">{job.cronExpression}</span>
												<span>TZ: {job.timezone ?? "UTC"}</span>
												{job.nextRunAt && (
													<span>
														Next:{" "}
														{new Date(job.nextRunAt).toLocaleString()}
													</span>
												)}
											</div>
											{job.lastRunAt && (
												<div className="flex items-center gap-2 mt-1 text-sm">
													<span className="text-muted-foreground">
														Last run:{" "}
														{new Date(job.lastRunAt).toLocaleString()}
													</span>
													{job.lastRunStatus && (
														<StatusBadge status={job.lastRunStatus} />
													)}
												</div>
											)}
										</div>
										<div className="flex items-center gap-3">
											<div className="flex items-center gap-2">
												<span className="text-sm text-muted-foreground">
													{job.enabled ? "Enabled" : "Disabled"}
												</span>
												<Switch
													checked={job.enabled ?? false}
													onCheckedChange={(checked) =>
														toggleMutation.mutate({
															jobId: job.id,
															enabled: checked,
														})
													}
													disabled={toggleMutation.isPending}
												/>
											</div>
											<Button
												variant="outline"
												size="sm"
												onClick={() => triggerMutation.mutate(job.id)}
												disabled={
													triggerMutation.isPending || !job.hasHandler
												}
											>
												{triggerMutation.isPending &&
												triggerMutation.variables === job.id ? (
													<Loader2 className="h-4 w-4 animate-spin" />
												) : (
													<Play className="h-4 w-4" />
												)}
												<span className="ml-1">Run Now</span>
											</Button>
										</div>
									</div>
								))}
							</div>
						) : (
							<div className="text-center py-8 text-muted-foreground">
								No cron jobs configured
							</div>
						)}

						{triggerMutation.isSuccess && (
							<div className="mt-4 p-3 rounded-md bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm">
								Job triggered successfully. Run ID:{" "}
								<Badge variant="outline" className="font-mono ml-1">
									{String(triggerMutation.data?.runId)}
								</Badge>
							</div>
						)}
						{triggerMutation.isError && (
							<div className="mt-4 p-3 rounded-md bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">
								Failed to trigger job: {triggerMutation.error?.message}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Recent Runs */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<div>
								<CardTitle className="flex items-center gap-2">
									<Activity className="h-5 w-5" />
									Recent Runs
								</CardTitle>
								<CardDescription>
									Execution history for all cron jobs
								</CardDescription>
							</div>
							<Select
								value={statusFilter}
								onValueChange={(value) => {
									setStatusFilter(value);
									setPage(1);
								}}
							>
								<SelectTrigger className="w-[130px]">
									<SelectValue placeholder="Status" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Status</SelectItem>
									<SelectItem value="running">Running</SelectItem>
									<SelectItem value="completed">Completed</SelectItem>
									<SelectItem value="failed">Failed</SelectItem>
									<SelectItem value="skipped">Skipped</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</CardHeader>
					<CardContent>
						{runsLoading ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
							</div>
						) : runsData?.runs && runsData.runs.length > 0 ? (
							<>
								<div className="divide-y divide-border">
									{runsData.runs.map((run) => (
										<div
											key={String(run.id)}
											className="py-3 flex items-center justify-between"
										>
											<div>
												<div className="flex items-center gap-2">
													<span className="font-medium">{run.jobId}</span>
													<StatusBadge status={run.status} />
												</div>
												<div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
													{run.startedAt && (
														<span>
															Started:{" "}
															{new Date(run.startedAt).toLocaleString()}
														</span>
													)}
													{run.completedAt && (
														<span>
															Completed:{" "}
															{new Date(run.completedAt).toLocaleString()}
														</span>
													)}
													{run.tasksEnqueued != null &&
														run.tasksEnqueued > 0 && (
															<span>Tasks: {run.tasksEnqueued}</span>
														)}
												</div>
												{run.errorMessage && (
													<div className="mt-1 text-sm text-red-600 dark:text-red-400">
														{run.errorMessage}
													</div>
												)}
											</div>
											<div className="text-sm text-muted-foreground font-mono">
												#{String(run.id)}
											</div>
										</div>
									))}
								</div>

								{/* Pagination */}
								{(runsData.total ?? 0) > pageSize && (
									<div className="mt-4 flex items-center justify-between">
										<p className="text-sm text-muted-foreground">
											Showing {(page - 1) * pageSize + 1} to{" "}
											{Math.min(page * pageSize, runsData.total ?? 0)} of{" "}
											{runsData.total ?? 0} runs
										</p>
										<div className="flex items-center gap-2">
											<Button
												variant="outline"
												size="sm"
												onClick={() => setPage((p) => Math.max(1, p - 1))}
												disabled={page === 1}
											>
												<ChevronLeft className="h-4 w-4" />
												Previous
											</Button>
											<span className="text-sm">
												Page {page} of{" "}
												{Math.ceil((runsData.total ?? 0) / pageSize)}
											</span>
											<Button
												variant="outline"
												size="sm"
												onClick={() => setPage((p) => p + 1)}
												disabled={
													page >= Math.ceil((runsData.total ?? 0) / pageSize)
												}
											>
												Next
												<ChevronRight className="h-4 w-4" />
											</Button>
										</div>
									</div>
								)}
							</>
						) : (
							<div className="text-center py-8 text-muted-foreground">
								No runs found
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</>
	);
}

function StatusBadge({ status }: { status: string }) {
	switch (status) {
		case "running":
			return (
				<Badge
					variant="secondary"
					className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
				>
					<Loader2 className="h-3 w-3 animate-spin mr-1" />
					Running
				</Badge>
			);
		case "completed":
			return (
				<Badge
					variant="secondary"
					className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
				>
					<CheckCircle className="h-3 w-3 mr-1" />
					Completed
				</Badge>
			);
		case "failed":
			return (
				<Badge
					variant="secondary"
					className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
				>
					<XCircle className="h-3 w-3 mr-1" />
					Failed
				</Badge>
			);
		case "skipped":
			return (
				<Badge
					variant="secondary"
					className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
				>
					<Pause className="h-3 w-3 mr-1" />
					Skipped
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}
