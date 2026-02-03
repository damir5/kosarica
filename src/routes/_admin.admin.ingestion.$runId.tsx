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
import { useMemo, useState } from "react";
import type { IngestionFile } from "@/components/admin/ingestion";
import {
	IngestionFileList,
	IngestionStoreStatsTable,
} from "@/components/admin/ingestion";
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

const SUMMARY_VARIANTS: Record<
	string,
	"secondary" | "destructive" | "outline"
> = {
	warning: "secondary",
	error: "destructive",
	critical: "destructive",
};

interface IngestionFileResponse {
	id: string;
	runId: string;
	filename: string;
	fileType: string;
	fileSize?: number | null;
	fileHash?: string | null;
	status: string;
	statusReason?: string | null;
	statusSeverity?: string | null;
	statusType?: string | null;
	entryCount?: number | null;
	rowCount?: number | null;
	persistedCount?: number | null;
	priceChanges?: number | null;
	failedRows?: number | null;
	warningRows?: number | null;
	storeCount?: number | null;
	processedAt?: string | null;
	metadata?: string | null;
	totalChunks?: number | null;
	processedChunks?: number | null;
	chunkSize?: number | null;
	createdAt?: string | null;
}

function mapToIngestionFile(file: IngestionFileResponse): IngestionFile {
	return {
		id: file.id,
		runId: file.runId,
		filename: file.filename,
		fileType: file.fileType,
		fileSize: file.fileSize ?? null,
		fileHash: file.fileHash ?? null,
		status: file.status,
		statusReason: file.statusReason ?? null,
		statusSeverity: file.statusSeverity ?? null,
		statusType: file.statusType ?? null,
		entryCount: file.entryCount ?? null,
		rowCount: file.rowCount ?? null,
		persistedCount: file.persistedCount ?? null,
		priceChanges: file.priceChanges ?? null,
		failedRows: file.failedRows ?? null,
		warningRows: file.warningRows ?? null,
		storeCount: file.storeCount ?? null,
		processedAt: file.processedAt ? new Date(file.processedAt) : null,
		metadata: file.metadata ?? null,
		totalChunks: file.totalChunks ?? null,
		processedChunks: file.processedChunks ?? null,
		chunkSize: file.chunkSize ?? null,
		createdAt: file.createdAt ? new Date(file.createdAt) : null,
	};
}

type ParsedErrorDetails = {
	url?: string;
	filename?: string;
	phase?: string;
	archiveId?: string;
	storageKey?: string;
	hash?: string;
	details?: string;
};

function parseErrorDetails(raw?: string): ParsedErrorDetails | null {
	if (!raw) {
		return null;
	}
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") {
			return parsed as ParsedErrorDetails;
		}
	} catch {
		return null;
	}
	return null;
}

function RunDetailPage() {
	const { runId } = Route.useParams() as { runId: string };
	const queryClient = useQueryClient();

	// Filter state
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [page, setPage] = useState(1);
	const pageSize = 20;
	const [storePage, setStorePage] = useState(1);
	const storePageSize = 25;

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

	// Store stats query
	const { data: storeStatsResponse, isLoading: storeStatsLoading } = useQuery(
		orpc.admin.ingestion.listRunStoreStats.queryOptions({
			input: {
				runId,
				limit: storePageSize,
				offset: (storePage - 1) * storePageSize,
			},
		}),
	);

	// Extract data from responses - now properly typed from ORPC handlers
	const run = runResponse;
	const filesData = filesResponse;
	const errorsData = errorsResponse;

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

	const formatDate = (date: string | Date | null | undefined) => {
		if (!date) return "N/A";
		return new Date(date).toLocaleString();
	};

	const formatDuration = (
		start: string | Date | null | undefined,
		end: string | Date | null | undefined,
	) => {
		if (!start) return "N/A";
		const startTime = new Date(start).getTime();
		const endTime = end ? new Date(end).getTime() : Date.now();
		const duration = endTime - startTime;
		if (duration < 0) return "N/A";
		const seconds = Math.floor(duration / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
		if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
		return `${seconds}s`;
	};

	const formatCount = (value?: number | null) => {
		if (value === null || value === undefined) return "-";
		return value.toLocaleString();
	};

	// Calculate aggregated run stats from store stats (must be before early returns for React hooks)
	const runStats = useMemo(() => {
		const stats = storeStatsResponse?.stores ?? [];
		if (stats.length === 0) {
			return {
				storeCount: 0,
				rowCount: 0,
				persistedCount: 0,
				priceChanges: 0,
				failedRows: 0,
				warningRows: 0,
			};
		}
		return stats.reduce(
			(acc, stat) => ({
				storeCount: acc.storeCount + 1,
				rowCount: acc.rowCount + (stat.rowCount ?? 0),
				persistedCount: acc.persistedCount + (stat.persistedCount ?? 0),
				priceChanges: acc.priceChanges + (stat.priceChanges ?? 0),
				failedRows: acc.failedRows + (stat.failedRows ?? 0),
				warningRows: acc.warningRows + (stat.warningRows ?? 0),
			}),
			{
				storeCount: 0,
				rowCount: 0,
				persistedCount: 0,
				priceChanges: 0,
				failedRows: 0,
				warningRows: 0,
			},
		);
	}, [storeStatsResponse]);

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
	const noFilesDiscovered = run.status === "completed" && totalFiles === 0;
	const summarySeverity = run.statusSeverity ?? "";
	const summaryLabel =
		summarySeverity === "warning" ? "info" : summarySeverity || "info";
	const storeStats = storeStatsResponse?.stores ?? [];
	const storeStatsTotal = storeStatsResponse?.total ?? 0;

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
							{run.statusReason && (
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<Badge
										variant={SUMMARY_VARIANTS[summarySeverity] || "outline"}
										className="text-xs"
									>
										{summaryLabel}
									</Badge>
									<span>{run.statusReason}</span>
								</div>
							)}
							{/* Note: Run-level rerun removed - API requires specific file/chunk/entry to rerun */}
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

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium">Data Summary</CardTitle>
						<CardDescription>
							Rows, stores, and changes processed in this run
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							<div>
								<div className="text-xs text-muted-foreground">Stores</div>
								<div className="text-2xl font-bold">
									{formatCount(runStats.storeCount)}
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground">Rows</div>
								<div className="text-2xl font-bold">
									{formatCount(runStats.rowCount)}
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground">Persisted</div>
								<div className="text-2xl font-bold">
									{formatCount(runStats.persistedCount)}
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground">
									Price Changes
								</div>
								<div className="text-2xl font-bold">
									{formatCount(runStats.priceChanges)}
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground">Failed Rows</div>
								<div
									className={`text-2xl font-bold ${(runStats.failedRows ?? 0) > 0 ? "text-destructive" : ""}`}
								>
									{formatCount(runStats.failedRows)}
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground">Warnings</div>
								<div
									className={`text-2xl font-bold ${(runStats.warningRows ?? 0) > 0 ? "text-amber-600" : ""}`}
								>
									{formatCount(runStats.warningRows)}
								</div>
							</div>
						</div>
					</CardContent>
				</Card>

				{noFilesDiscovered && (
					<Card>
						<CardContent className="py-4 text-sm text-muted-foreground">
							No files were discovered for the requested date. We do not
							backfill older files; existing prices remain in place until the
							retailer publishes an update.
						</CardContent>
					</Card>
				)}

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
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Status Reason
								</div>
								<p className="mt-1">{run.statusReason ?? "—"}</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Status Severity
								</div>
								<p className="mt-1">
									{run.statusSeverity === "warning"
										? "info"
										: (run.statusSeverity ?? "—")}
								</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Status Type
								</div>
								<p className="mt-1">{run.statusType ?? "—"}</p>
							</div>
							{/* Note: parentRunId and rerunType fields are not returned by the SDK */}
						</div>
					</CardContent>
				</Card>

				{/* Recent Errors */}
				{errorsData && (errorsData.errors?.length ?? 0) > 0 && (
					<Card className="border-destructive/50">
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-destructive">
								<AlertTriangle className="h-5 w-5" />
								Recent Errors
							</CardTitle>
							<CardDescription>
								Last {errorsData.errors?.length ?? 0} errors from this run
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="space-y-3">
								{(errorsData.errors ?? []).slice(0, 5).map((error) => {
									const parsedDetails = parseErrorDetails(error.errorDetails);
									const detailText =
										parsedDetails?.details ?? error.errorDetails;
									const contextParts = [
										parsedDetails?.phase
											? `Phase: ${parsedDetails.phase}`
											: null,
										parsedDetails?.filename
											? `File: ${parsedDetails.filename}`
											: null,
										parsedDetails?.archiveId
											? `Archive: ${parsedDetails.archiveId}`
											: null,
									].filter(Boolean);

									return (
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
															{error.severity === "warning"
																? "info"
																: error.severity}
														</Badge>
													</div>
													<p className="mt-1 text-sm">{error.errorMessage}</p>
													{parsedDetails?.url && (
														<p className="mt-1 text-xs text-muted-foreground break-all">
															URL: {parsedDetails.url}
														</p>
													)}
													{contextParts.length > 0 && (
														<p className="mt-1 text-xs text-muted-foreground">
															{contextParts.join(" · ")}
														</p>
													)}
													{error.fileId && (
														<p className="mt-1 text-xs text-muted-foreground font-mono">
															File: {error.fileId}
														</p>
													)}
													{detailText && (
														<pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">
															{detailText}
														</pre>
													)}
												</div>
												<span className="text-xs text-muted-foreground">
													{error.createdAt
														? new Date(error.createdAt).toLocaleTimeString()
														: ""}
												</span>
											</div>
										</div>
									);
								})}
							</div>
						</CardContent>
					</Card>
				)}

				<Card>
					<CardHeader>
						<CardTitle>Store Stats</CardTitle>
						<CardDescription>Per-store totals for this run</CardDescription>
					</CardHeader>
					<CardContent>
						<IngestionStoreStatsTable
							stores={storeStats}
							isLoading={storeStatsLoading}
							showFileCount
							emptyLabel="No store stats recorded for this run"
						/>

						{storeStatsTotal > storePageSize && (
							<div className="mt-4 flex items-center justify-between">
								<p className="text-sm text-muted-foreground">
									Showing {(storePage - 1) * storePageSize + 1} to{" "}
									{Math.min(storePage * storePageSize, storeStatsTotal)} of{" "}
									{storeStatsTotal} stores
								</p>
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={() => setStorePage((p) => Math.max(1, p - 1))}
										disabled={storePage === 1}
									>
										<ChevronLeft className="h-4 w-4" />
										Previous
									</Button>
									<span className="text-sm">
										Page {storePage} of{" "}
										{Math.ceil(storeStatsTotal / storePageSize)}
									</span>
									<Button
										variant="outline"
										size="sm"
										onClick={() => setStorePage((p) => p + 1)}
										disabled={
											storePage >= Math.ceil(storeStatsTotal / storePageSize)
										}
									>
										Next
										<ChevronRight className="h-4 w-4" />
									</Button>
								</div>
							</div>
						)}
					</CardContent>
				</Card>

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
							files={(filesData?.files ?? []).map(mapToIngestionFile)}
							runId={runId}
							isLoading={filesLoading}
							onRerunFile={(fileId) => rerunFileMutation.mutate(fileId)}
							isRerunning={rerunFileMutation.isPending}
							rerunningFileId={rerunningFileId}
						/>

						{/* Pagination */}
						{filesData && (filesData.total ?? 0) > pageSize && (
							<div className="mt-4 flex items-center justify-between">
								<p className="text-sm text-muted-foreground">
									Showing {(page - 1) * pageSize + 1} to{" "}
									{Math.min(page * pageSize, filesData.total ?? 0)} of{" "}
									{filesData.total ?? 0} files
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
										{Math.ceil((filesData.total ?? 0) / pageSize)}
									</span>
									<Button
										variant="outline"
										size="sm"
										onClick={() => setPage((p) => p + 1)}
										disabled={
											page >= Math.ceil((filesData.total ?? 0) / pageSize)
										}
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
