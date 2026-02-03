import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowLeft,
	CheckCircle,
	ChevronLeft,
	ChevronRight,
	Clock,
	FileText,
	Loader2,
	Package,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import {
	IngestionChunkList,
	IngestionStoreStatsTable,
	RerunButton,
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

export const Route = createFileRoute("/_admin/admin/ingestion/$runId/$fileId")({
	component: FileDetailPage,
});

type ChunkStatus = "pending" | "processing" | "completed" | "failed";

interface FileData {
	id?: string;
	runId?: string;
	filename?: string;
	fileType?: string;
	fileSize?: number | null;
	fileHash?: string | null;
	status?: string;
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

interface ChunkData {
	id?: string;
	fileId?: string;
	chunkIndex?: number;
	startRow?: number;
	endRow?: number;
	rowCount?: number;
	status?: string;
	r2Key?: string | null;
	persistedCount?: number | null;
	errorCount?: number | null;
	processedAt?: string | null;
	createdAt?: string | null;
}

interface ChunksResponse {
	chunks?: ChunkData[];
	total?: number;
	totalPages?: number;
}

interface ErrorData {
	id?: string;
	errorType?: string;
	errorMessage?: string;
	errorDetails?: string;
	severity?: string;
	chunkId?: string | null;
	createdAt?: string | null;
}

interface ErrorsResponse {
	errors?: ErrorData[];
	total?: number;
}

const STATUS_ICONS = {
	pending: Clock,
	processing: Loader2,
	completed: CheckCircle,
	failed: XCircle,
};

const STATUS_COLORS = {
	pending: "secondary",
	processing: "default",
	completed: "default",
	failed: "destructive",
} as const;

const FILE_TYPE_COLORS: Record<string, string> = {
	csv: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
	xml: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
	xlsx: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
	zip: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
	json: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
};

const SUMMARY_VARIANTS: Record<
	string,
	"secondary" | "destructive" | "outline"
> = {
	warning: "secondary",
	error: "destructive",
	critical: "destructive",
};

function mapChunk(chunk: ChunkData) {
	return {
		id: chunk.id ?? "",
		fileId: chunk.fileId ?? "",
		chunkIndex: chunk.chunkIndex ?? 0,
		startRow: chunk.startRow ?? 0,
		endRow: chunk.endRow ?? 0,
		rowCount: chunk.rowCount ?? 0,
		status: chunk.status ?? "pending",
		r2Key: chunk.r2Key ?? null,
		persistedCount: chunk.persistedCount ?? null,
		errorCount: chunk.errorCount ?? null,
		processedAt: chunk.processedAt ? new Date(chunk.processedAt) : null,
		createdAt: chunk.createdAt ? new Date(chunk.createdAt) : null,
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

function FileDetailPage() {
	const { runId, fileId } = Route.useParams() as {
		runId: string;
		fileId: string;
	};
	const queryClient = useQueryClient();

	// Filter state
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [page, setPage] = useState(1);
	const pageSize = 20;
	const [errorPage, setErrorPage] = useState(1);
	const errorPageSize = 20;
	const [storePage, setStorePage] = useState(1);
	const storePageSize = 25;

	// File query
	const {
		data: fileResponse,
		isLoading: fileLoading,
		error: fileError,
	} = useQuery(
		orpc.admin.ingestion.getFile.queryOptions({
			input: { fileId },
		}),
	);

	// Chunks query
	const { data: chunksResponse, isLoading: chunksLoading } = useQuery(
		orpc.admin.ingestion.listChunks.queryOptions({
			input: {
				fileId,
				status:
					statusFilter !== "all" ? (statusFilter as ChunkStatus) : undefined,
				page,
				pageSize,
			},
		}),
	);

	// Errors query
	const { data: errorsResponse } = useQuery(
		orpc.admin.ingestion.listFileErrors.queryOptions({
			input: {
				fileId,
				page: errorPage,
				pageSize: errorPageSize,
			},
		}),
	);

	// Store stats query
	const { data: storeStatsResponse, isLoading: storeStatsLoading } = useQuery(
		orpc.admin.ingestion.listFileStoreStats.queryOptions({
			input: {
				fileId,
				limit: storePageSize,
				offset: (storePage - 1) * storePageSize,
			},
		}),
	);

	// Extract data from responses (handlers now return unwrapped data directly)
	const file = fileResponse as FileData | null;
	const chunksData = chunksResponse as ChunksResponse | null;
	const errorsData = errorsResponse as ErrorsResponse | null;

	// Rerun mutations
	const rerunFileMutation = useMutation({
		mutationFn: async () => {
			return orpc.admin.ingestion.rerunFile.call({ fileId });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "ingestion"] });
		},
	});

	const [rerunningChunkId, setRerunningChunkId] = useState<string | null>(null);

	const rerunChunkMutation = useMutation({
		mutationFn: async (chunkId: string) => {
			setRerunningChunkId(chunkId);
			return orpc.admin.ingestion.rerunChunk.call({ chunkId });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "ingestion"] });
			setRerunningChunkId(null);
		},
		onError: () => {
			setRerunningChunkId(null);
		},
	});

	const formatDate = (date: string | null | undefined) => {
		if (!date) return "N/A";
		return new Date(date).toLocaleString();
	};

	const formatFileSize = (bytes: number | null | undefined) => {
		if (bytes === null || bytes === undefined) return "Unknown";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
	};

	const formatCount = (value?: number | null) => {
		if (value === null || value === undefined) return "-";
		return value.toLocaleString();
	};

	if (fileLoading) {
		return (
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
				<div className="flex items-center justify-center py-12">
					<p className="text-muted-foreground">Loading file details...</p>
				</div>
			</div>
		);
	}

	if (fileError || !file) {
		return (
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
					<p className="text-sm text-destructive">
						Error: {fileError?.message || "File not found"}
					</p>
				</div>
				<Button variant="outline" className="mt-4" asChild>
					<a href={`/admin/ingestion/${runId}`}>
						<ArrowLeft className="mr-2 h-4 w-4" />
						Back to Run
					</a>
				</Button>
			</div>
		);
	}

	const StatusIcon =
		STATUS_ICONS[file.status as keyof typeof STATUS_ICONS] || Clock;
	const totalChunks = file.totalChunks ?? 0;
	const processedChunks = file.processedChunks ?? 0;
	const chunkProgress =
		totalChunks > 0 ? Math.round((processedChunks / totalChunks) * 100) : 0;
	const summarySeverity = file.statusSeverity ?? "";
	const summaryLabel =
		summarySeverity === "warning" ? "info" : summarySeverity || "info";
	const storeStats = storeStatsResponse?.stores ?? [];
	const storeStatsTotal = storeStatsResponse?.total ?? 0;
	const rowCount = file.rowCount ?? file.entryCount ?? null;

	return (
		<>
			{/* Header */}
			<div className="border-border border-b bg-card">
				<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
					<div className="flex items-center gap-4">
						<Button variant="ghost" size="icon" asChild>
							<a href={`/admin/ingestion/${runId}`}>
								<ArrowLeft className="h-5 w-5" />
							</a>
						</Button>
						<div className="flex-1">
							<div className="flex items-center gap-3">
								<FileText className="h-8 w-8 text-primary" />
								<div>
									<h1
										className="font-semibold text-2xl text-foreground truncate max-w-[500px]"
										title={file.filename}
									>
										{file.filename}
									</h1>
									<p className="mt-1 text-muted-foreground text-sm font-mono">
										{file.id}
									</p>
								</div>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<span
								className={`px-2 py-1 rounded text-xs font-medium ${FILE_TYPE_COLORS[(file.fileType ?? "").toLowerCase()] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
							>
								{(file.fileType ?? "").toUpperCase()}
							</span>
							<Badge
								variant={
									STATUS_COLORS[file.status as keyof typeof STATUS_COLORS] ||
									"secondary"
								}
								className={file.status === "processing" ? "animate-pulse" : ""}
							>
								<StatusIcon
									className={`mr-1 h-3 w-3 ${file.status === "processing" ? "animate-spin" : ""}`}
								/>
								{file.status}
							</Badge>
							{file.statusReason && (
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<Badge
										variant={SUMMARY_VARIANTS[summarySeverity] || "outline"}
										className="text-xs"
									>
										{summaryLabel}
									</Badge>
									<span>{file.statusReason}</span>
								</div>
							)}
							{(file.status === "completed" || file.status === "failed") && (
								<RerunButton
									onRerun={() => rerunFileMutation.mutate()}
									isLoading={rerunFileMutation.isPending}
									label="Rerun File"
								/>
							)}
						</div>
					</div>
					{/* Breadcrumb */}
					<div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
						<a href="/admin/ingestion" className="hover:text-foreground">
							Ingestion
						</a>
						<span>/</span>
						<a
							href={`/admin/ingestion/${runId}`}
							className="hover:text-foreground font-mono"
						>
							{runId.slice(0, 12)}...
						</a>
						<span>/</span>
						<span className="text-foreground">{file.filename}</span>
					</div>
				</div>
			</div>

			{/* Main Content */}
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
				{/* File Overview */}
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium">
								Chunk Progress
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{chunkProgress}%</div>
							<div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
								<div
									className={`h-full transition-all duration-300 ${
										file.status === "failed"
											? "bg-destructive"
											: file.status === "completed"
												? "bg-green-500"
												: "bg-primary"
									}`}
									style={{ width: `${chunkProgress}%` }}
								/>
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								{processedChunks} of {totalChunks} chunks
							</p>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium">Rows</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{formatCount(rowCount)}</div>
							<p className="text-xs text-muted-foreground">
								rows parsed from this file
							</p>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium">File Size</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{formatFileSize(file.fileSize)}
							</div>
							<p className="text-xs text-muted-foreground font-mono">
								{file.fileHash ? `${file.fileHash.slice(0, 16)}...` : "No hash"}
							</p>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium">Chunk Size</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{file.chunkSize ? file.chunkSize.toLocaleString() : "N/A"}
							</div>
							<p className="text-xs text-muted-foreground">rows per chunk</p>
						</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium">
							Processing Summary
						</CardTitle>
						<CardDescription>
							Rows, stores, and changes processed for this file
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							<div>
								<div className="text-xs text-muted-foreground">Stores</div>
								<div className="text-2xl font-bold">
									{formatCount(file.storeCount)}
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground">Rows</div>
								<div className="text-2xl font-bold">
									{formatCount(rowCount)}
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground">Persisted</div>
								<div className="text-2xl font-bold">
									{formatCount(file.persistedCount)}
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground">
									Price Changes
								</div>
								<div className="text-2xl font-bold">
									{formatCount(file.priceChanges)}
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground">Failed Rows</div>
								<div
									className={`text-2xl font-bold ${(file.failedRows ?? 0) > 0 ? "text-destructive" : ""}`}
								>
									{formatCount(file.failedRows)}
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground">Warnings</div>
								<div
									className={`text-2xl font-bold ${(file.warningRows ?? 0) > 0 ? "text-amber-600" : ""}`}
								>
									{formatCount(file.warningRows)}
								</div>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* File Details */}
				<Card>
					<CardHeader>
						<CardTitle>File Details</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Filename
								</div>
								<p className="mt-1 font-medium truncate" title={file.filename}>
									{file.filename}
								</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									File Type
								</div>
								<p className="mt-1 font-medium uppercase">{file.fileType}</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Created At
								</div>
								<p className="mt-1">{formatDate(file.createdAt)}</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Processed At
								</div>
								<p className="mt-1">{formatDate(file.processedAt)}</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Status Reason
								</div>
								<p className="mt-1">{file.statusReason ?? "—"}</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Status Severity
								</div>
								<p className="mt-1">
									{file.statusSeverity === "warning"
										? "info"
										: (file.statusSeverity ?? "—")}
								</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Status Type
								</div>
								<p className="mt-1">{file.statusType ?? "—"}</p>
							</div>
							{file.fileHash && (
								<div className="sm:col-span-2">
									<div className="text-sm font-medium text-muted-foreground">
										File Hash
									</div>
									<p className="mt-1 font-mono text-sm break-all">
										{file.fileHash}
									</p>
								</div>
							)}
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Store Stats</CardTitle>
						<CardDescription>Per-store totals for this file</CardDescription>
					</CardHeader>
					<CardContent>
						<IngestionStoreStatsTable
							stores={storeStats}
							isLoading={storeStatsLoading}
							emptyLabel="No store stats recorded for this file"
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

				{/* Recent Errors */}
				{errorsData && (errorsData.errors?.length ?? 0) > 0 && (
					<Card className="border-destructive/50">
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-destructive">
								<AlertTriangle className="h-5 w-5" />
								File Errors
							</CardTitle>
							<CardDescription>
								Errors encountered while processing this file
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="space-y-3">
								{(errorsData.errors ?? []).map((error) => {
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
										parsedDetails?.storageKey
											? `Storage: ${parsedDetails.storageKey}`
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
														{error.chunkId && (
															<span className="text-xs text-muted-foreground font-mono">
																Chunk: {error.chunkId.slice(0, 12)}...
															</span>
														)}
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
							{errorsData.total && errorsData.total > errorPageSize && (
								<div className="mt-4 flex items-center justify-between">
									<p className="text-sm text-muted-foreground">
										Showing {(errorPage - 1) * errorPageSize + 1} to{" "}
										{Math.min(errorPage * errorPageSize, errorsData.total)} of{" "}
										{errorsData.total} errors
									</p>
									<div className="flex items-center gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => setErrorPage((p) => Math.max(1, p - 1))}
											disabled={errorPage === 1}
										>
											<ChevronLeft className="h-4 w-4" />
											Previous
										</Button>
										<span className="text-sm">
											Page {errorPage} of{" "}
											{Math.ceil(errorsData.total / errorPageSize)}
										</span>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setErrorPage((p) => p + 1)}
											disabled={
												errorPage >= Math.ceil(errorsData.total / errorPageSize)
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
				)}

				{/* Chunks List */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<div>
								<CardTitle className="flex items-center gap-2">
									<Package className="h-5 w-5" />
									Chunks
								</CardTitle>
								<CardDescription>
									Data chunks processed from this file
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
									<SelectItem value="pending">Pending</SelectItem>
									<SelectItem value="processing">Processing</SelectItem>
									<SelectItem value="completed">Completed</SelectItem>
									<SelectItem value="failed">Failed</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</CardHeader>
					<CardContent>
						<IngestionChunkList
							chunks={(chunksData?.chunks ?? []).map(mapChunk)}
							isLoading={chunksLoading}
							onRerunChunk={(chunkId) => rerunChunkMutation.mutate(chunkId)}
							isRerunning={rerunChunkMutation.isPending}
							rerunningChunkId={rerunningChunkId}
						/>

						{/* Pagination */}
						{chunksData && (chunksData.totalPages ?? 0) > 1 && (
							<div className="mt-4 flex items-center justify-between">
								<p className="text-sm text-muted-foreground">
									Showing {(page - 1) * pageSize + 1} to{" "}
									{Math.min(page * pageSize, chunksData.total ?? 0)} of{" "}
									{chunksData.total ?? 0} chunks
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
										Page {page} of {chunksData.totalPages ?? 1}
									</span>
									<Button
										variant="outline"
										size="sm"
										onClick={() => setPage((p) => p + 1)}
										disabled={page >= (chunksData.totalPages ?? 1)}
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
