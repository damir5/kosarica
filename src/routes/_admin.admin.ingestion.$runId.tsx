import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Activity,
	AlertTriangle,
	ArrowLeft,
	CheckCircle,
	ChevronLeft,
	ChevronRight,
	Clock,
	FileText,
	Loader2,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { IngestionFileList, RerunButton } from "@/components/admin/ingestion";
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
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/ingestion/$runId")({
	component: RunDetailPage,
});

// Types for Go service responses
interface RunData {
	id: string;
	chainSlug: string;
	status: string;
	source: string;
	totalFiles: number | null;
	processedFiles: number | null;
	totalEntries: number | null;
	processedEntries: number | null;
	errorCount: number | null;
	startedAt: Date | null;
	completedAt: Date | null;
	parentRunId: string | null;
	rerunType: string | null;
}

interface FileData {
	id: string;
	runId: string;
	filename: string;
	fileType: string;
	fileSize: number | null;
	fileHash: string | null;
	status: string;
	entryCount: number | null;
	processedAt: Date | null;
	metadata: string | null;
	totalChunks: number | null;
	processedChunks: number | null;
	chunkSize: number | null;
	createdAt: Date | null;
}

interface FilesResponse {
	files: FileData[];
	total: number;
	totalPages: number;
}

interface ErrorData {
	id: string;
	errorType: string;
	errorMessage: string;
	severity: string;
	fileId: string | null;
	createdAt: Date | null;
}

interface ErrorsResponse {
	errors: ErrorData[];
	total: number;
}

const STATUS_ICONS = {
	pending: Clock,
	running: Loader2,
	completed: CheckCircle,
	failed: XCircle,
};

const STATUS_COLORS = {
	pending: "secondary",
	running: "default",
	completed: "default",
	failed: "destructive",
} as const;

function RunDetailPage() {
	const { runId } = Route.useParams() as { runId: string };
	const queryClient = useQueryClient();

	// Filter state
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [page, setPage] = useState(1);
	const pageSize = 20;

	// Run query
	const {
		data: runResponse,
		isLoading: runLoading,
		error: runError,
	} = useQuery(
		orpc.admin.ingestion.getRun.queryOptions({
			input: { runId },
		}),
	);

	// Files query
	const { data: filesResponse, isLoading: filesLoading } = useQuery(
		orpc.admin.ingestion.listFiles.queryOptions({
			input: {
				runId,
				limit: pageSize,
				offset: (page - 1) * pageSize,
			},
		}),
	);

	// Errors query
	const { data: errorsResponse } = useQuery(
		orpc.admin.ingestion.listErrors.queryOptions({
			input: {
				runId,
				limit: 10,
				offset: 0,
			},
		}),
	);

	// Extract data from responses
	const run = runResponse?.success ? (runResponse.data as RunData) : null;
	const filesData = filesResponse?.success ? (filesResponse.data as FilesResponse) : null;
	const errorsData = errorsResponse?.success ? (errorsResponse.data as ErrorsResponse) : null;

	// Rerun mutations
	const rerunRunMutation = useMutation({
		mutationFn: async () => {
			return orpc.admin.ingestion.rerunRun.call({ runId });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "ingestion"] });
		},
	});

	const [rerunningFileId, setRerunningFileId] = useState<string | null>(null);

	const rerunFileMutation = useMutation({
		mutationFn: async (fileId: string) => {
			setRerunningFileId(fileId);
			return orpc.admin.ingestion.rerunFile.call({ fileId });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "ingestion"] });
			setRerunningFileId(null);
		},
		onError: () => {
			setRerunningFileId(null);
		},
	});

	const formatDate = (date: Date | null) => {
		if (!date) return "N/A";
		return new Date(date).toLocaleString();
	};

	const formatDuration = (start: Date | null, end: Date | null) => {
		if (!start) return "N/A";
		const startTime = new Date(start).getTime();
		const endTime = end ? new Date(end).getTime() : Date.now();
		const duration = endTime - startTime;
		const seconds = Math.floor(duration / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
		if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
		return `${seconds}s`;
	};

	if (runLoading) {
		return (
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
				<div className="flex items-center justify-center py-12">
					<p className="text-muted-foreground">Loading run details...</p>
				</div>
			</div>
		);
	}

	if (runError || !run) {
		return (
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
					<p className="text-sm text-destructive">
						Error: {runError?.message || "Run not found"}
					</p>
				</div>
				<Button variant="outline" className="mt-4" asChild>
					<a href="/admin/ingestion">
						<ArrowLeft className="mr-2 h-4 w-4" />
						Back to Ingestion
					</a>
				</Button>
			</div>
		);
	}

	const StatusIcon =
		STATUS_ICONS[run.status as keyof typeof STATUS_ICONS] || Clock;
	const totalFiles = run.totalFiles ?? 0;
	const processedFiles = run.processedFiles ?? 0;
	const progress =
		totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;

	return (
		<>
			{/* Header */}
			<div className="border-border border-b bg-card">
				<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
					<div className="flex items-center gap-4">
						<Button variant="ghost" size="icon" asChild>
							<a href="/admin/ingestion">
								<ArrowLeft className="h-5 w-5" />
							</a>
						</Button>
						<div className="flex-1">
							<div className="flex items-center gap-3">
								<Activity className="h-8 w-8 text-primary" />
								<div>
									<h1 className="font-semibold text-2xl text-foreground">
										{run.chainSlug} Ingestion Run
									</h1>
									<p className="mt-1 text-muted-foreground text-sm font-mono">
										{run.id}
									</p>
								</div>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Badge
								variant={
									STATUS_COLORS[run.status as keyof typeof STATUS_COLORS] ||
									"secondary"
								}
								className={run.status === "running" ? "animate-pulse" : ""}
							>
								<StatusIcon
									className={`mr-1 h-3 w-3 ${run.status === "running" ? "animate-spin" : ""}`}
								/>
								{run.status}
							</Badge>
							{run.parentRunId && <Badge variant="outline">Rerun</Badge>}
							{(run.status === "completed" || run.status === "failed") && (
								<RerunButton
									onRerun={() => rerunRunMutation.mutate()}
									isLoading={rerunRunMutation.isPending}
									label="Rerun"
								/>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* Main Content */}
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
				{/* Run Overview */}
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium">Progress</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{progress}%</div>
							<div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
								<div
									className={`h-full transition-all duration-300 ${
										run.status === "failed"
											? "bg-destructive"
											: run.status === "completed"
												? "bg-green-500"
												: "bg-primary"
									}`}
									style={{ width: `${progress}%` }}
								/>
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								{processedFiles} of {totalFiles} files
							</p>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium">Entries</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{(run.processedEntries ?? 0).toLocaleString()}
							</div>
							<p className="text-xs text-muted-foreground">
								of {(run.totalEntries ?? 0).toLocaleString()} total entries
							</p>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium">Errors</CardTitle>
						</CardHeader>
						<CardContent>
							<div
								className={`text-2xl font-bold ${(run.errorCount ?? 0) > 0 ? "text-destructive" : ""}`}
							>
								{(run.errorCount ?? 0).toLocaleString()}
							</div>
							<p className="text-xs text-muted-foreground">
								{errorsData?.total ?? 0} logged errors
							</p>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium">Duration</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{formatDuration(run.startedAt, run.completedAt)}
							</div>
							<p className="text-xs text-muted-foreground">
								Started: {formatDate(run.startedAt)}
							</p>
						</CardContent>
					</Card>
				</div>

				{/* Run Details */}
				<Card>
					<CardHeader>
						<CardTitle>Run Details</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Chain
								</div>
								<p className="mt-1 font-medium">{run.chainSlug}</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Source
								</div>
								<p className="mt-1 font-medium capitalize">{run.source}</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Started At
								</div>
								<p className="mt-1">{formatDate(run.startedAt)}</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Completed At
								</div>
								<p className="mt-1">{formatDate(run.completedAt)}</p>
							</div>
							{run.parentRunId && (
								<div>
									<div className="text-sm font-medium text-muted-foreground">
										Parent Run
									</div>
									<p className="mt-1">
										<a
											href={`/admin/ingestion/${run.parentRunId}`}
											className="text-primary hover:underline font-mono text-sm"
										>
											{run.parentRunId}
										</a>
									</p>
								</div>
							)}
							{run.rerunType && (
								<div>
									<div className="text-sm font-medium text-muted-foreground">
										Rerun Type
									</div>
									<p className="mt-1 capitalize">{run.rerunType}</p>
								</div>
							)}
						</div>
					</CardContent>
				</Card>

				{/* Recent Errors */}
				{errorsData && errorsData.errors.length > 0 && (
					<Card className="border-destructive/50">
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-destructive">
								<AlertTriangle className="h-5 w-5" />
								Recent Errors
							</CardTitle>
							<CardDescription>
								Last {errorsData.errors.length} errors from this run
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="space-y-3">
								{errorsData.errors.slice(0, 5).map((error) => (
									<div
										key={error.id}
										className="p-3 rounded-lg border bg-destructive/5 border-destructive/20"
									>
										<div className="flex items-start justify-between">
											<div className="flex-1">
												<div className="flex items-center gap-2">
													<Badge variant="outline" className="text-xs">
														{error.errorType}
													</Badge>
													<Badge
														variant={
															error.severity === "critical"
																? "destructive"
																: "secondary"
														}
														className="text-xs"
													>
														{error.severity}
													</Badge>
												</div>
												<p className="mt-1 text-sm">{error.errorMessage}</p>
												{error.fileId && (
													<p className="mt-1 text-xs text-muted-foreground font-mono">
														File: {error.fileId}
													</p>
												)}
											</div>
											<span className="text-xs text-muted-foreground">
												{error.createdAt
													? new Date(error.createdAt).toLocaleTimeString()
													: ""}
											</span>
										</div>
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				)}

				{/* Files List */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<div>
								<CardTitle className="flex items-center gap-2">
									<FileText className="h-5 w-5" />
									Files
								</CardTitle>
								<CardDescription>Files processed in this run</CardDescription>
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
									<SelectItem value="pending">Pending</SelectItem>
									<SelectItem value="processing">Processing</SelectItem>
									<SelectItem value="completed">Completed</SelectItem>
									<SelectItem value="failed">Failed</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</CardHeader>
					<CardContent>
						<IngestionFileList
							files={filesData?.files ?? []}
							runId={runId}
							isLoading={filesLoading}
							onRerunFile={(fileId) => rerunFileMutation.mutate(fileId)}
							isRerunning={rerunFileMutation.isPending}
							rerunningFileId={rerunningFileId}
						/>

						{/* Pagination */}
						{filesData && filesData.totalPages > 1 && (
							<div className="mt-4 flex items-center justify-between">
								<p className="text-sm text-muted-foreground">
									Showing {(page - 1) * pageSize + 1} to{" "}
									{Math.min(page * pageSize, filesData.total)} of{" "}
									{filesData.total} files
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
										Page {page} of {filesData.totalPages}
									</span>
									<Button
										variant="outline"
										size="sm"
										onClick={() => setPage((p) => p + 1)}
										disabled={page >= filesData.totalPages}
									>
										Next
										<ChevronRight className="h-4 w-4" />
									</Button>
								</div>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</>
	);
}
