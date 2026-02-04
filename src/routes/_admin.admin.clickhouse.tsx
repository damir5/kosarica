import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Database,
	ExternalLink,
	Loader2,
	RefreshCw,
	TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
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
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/clickhouse")({
	component: ClickHouseAdminPage,
});

function formatDateTime(value: Date | string | null | undefined): string {
	if (!value) return "-";
	const d = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(d.getTime())) return "-";
	return d.toLocaleString();
}

function ClickHouseAdminPage() {
	const queryClient = useQueryClient();
	const [confirmAllOpen, setConfirmAllOpen] = useState(false);

	const statusQuery = useQuery(orpc.admin.clickhouse.status.queryOptions({}));
	const status = statusQuery.data;

	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: orpc.admin.clickhouse.key({ type: "query" }),
		});
	};

	const startSyncMutation = useMutation({
		mutationFn: async (mode: "missing" | "all") => {
			return orpc.admin.clickhouse.startSync.call({ mode });
		},
		onSuccess: () => {
			invalidate();
			toast.success("ClickHouse sync scheduled");
		},
		onError: (err) => {
			toast.error(err instanceof Error ? err.message : String(err));
		},
	});

	const lastTaskLink = useMemo(() => {
		const id = startSyncMutation.data?.taskId;
		return id ? `/admin/task-queue?search=${encodeURIComponent(id)}` : null;
	}, [startSyncMutation.data?.taskId]);

	return (
		<>
			<div className="border-border border-b bg-card">
				<div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
					<div className="flex items-center justify-between gap-4">
						<div className="flex items-center gap-3">
							<Database className="h-8 w-8 text-primary" />
							<div>
								<h1 className="font-semibold text-2xl text-foreground">
									ClickHouse
								</h1>
								<p className="mt-1 text-muted-foreground text-sm">
									Parquet import status and admin actions
								</p>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="icon"
								onClick={invalidate}
								disabled={statusQuery.isLoading}
							>
								<RefreshCw
									className={cn(
										"h-4 w-4",
										statusQuery.isFetching && "animate-spin",
									)}
								/>
							</Button>
						</div>
					</div>
				</div>
			</div>

			<div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
				{statusQuery.isLoading ? (
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						Loading status...
					</div>
				) : statusQuery.isError ? (
					<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
						{statusQuery.error.message}
					</div>
				) : (
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm font-medium">
									Parquet Files
								</CardTitle>
								<CardDescription>Total discovered</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="font-mono text-lg">
									{String(status?.totalFiles ?? 0)}
								</div>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm font-medium">Imported</CardTitle>
								<CardDescription>Marked imported</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="font-mono text-lg">
									{String(status?.importedFiles ?? 0)}
								</div>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm font-medium">Pending</CardTitle>
								<CardDescription>Missing imports</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="font-mono text-lg">
									{String(status?.pendingFiles ?? 0)}
								</div>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm font-medium">
									Last Imported
								</CardTitle>
								<CardDescription>Latest importedAt</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="font-mono text-sm break-all">
									{formatDateTime(status?.lastImportedAt)}
								</div>
							</CardContent>
						</Card>
					</div>
				)}

				<Card>
					<CardHeader>
						<CardTitle>Sync Actions</CardTitle>
						<CardDescription>
							Runs sync via the task queue (recommended for long imports)
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								disabled={startSyncMutation.isPending}
								onClick={() => startSyncMutation.mutate("missing")}
							>
								{startSyncMutation.isPending ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : null}
								Load missing
							</Button>
							<Button
								variant="destructive"
								disabled={startSyncMutation.isPending}
								onClick={() => setConfirmAllOpen(true)}
							>
								<TriangleAlert className="mr-2 h-4 w-4" />
								Rebuild (load all)
							</Button>

							{startSyncMutation.isSuccess && startSyncMutation.data?.taskId ? (
								<Badge variant="secondary" className="font-mono text-xs">
									Task: {startSyncMutation.data.taskId}
								</Badge>
							) : null}

							{lastTaskLink ? (
								<Link
									to={lastTaskLink}
									className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
								>
									View in Task Queue
									<ExternalLink className="h-4 w-4" />
								</Link>
							) : (
								<Link
									to="/admin/task-queue"
									search={{}}
									className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
								>
									Open Task Queue
									<ExternalLink className="h-4 w-4" />
								</Link>
							)}
						</div>
						{startSyncMutation.isError ? (
							<div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
								{startSyncMutation.error.message}
							</div>
						) : null}
					</CardContent>
				</Card>
			</div>

			{confirmAllOpen && (
				<Dialog open={true} onOpenChange={() => setConfirmAllOpen(false)}>
					<DialogContent className="sm:max-w-lg">
						<DialogHeader>
							<DialogTitle>Rebuild ClickHouse prices?</DialogTitle>
							<DialogDescription>
								This will truncate the ClickHouse `prices` table and re-import
								all Parquet files. Use when ClickHouse is out of sync.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button
								variant="outline"
								onClick={() => setConfirmAllOpen(false)}
								disabled={startSyncMutation.isPending}
							>
								Back
							</Button>
							<Button
								variant="destructive"
								disabled={startSyncMutation.isPending}
								onClick={() => {
									setConfirmAllOpen(false);
									startSyncMutation.mutate("all");
								}}
							>
								{startSyncMutation.isPending ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : null}
								Confirm rebuild
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}
