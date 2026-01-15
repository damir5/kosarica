import { CheckCircle, Clock, Loader2, PlayCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { RerunButton } from "./RerunButton";

export interface IngestionRun {
	id: string;
	chainSlug: string;
	source: string;
	status: string; // 'pending' | 'running' | 'completed' | 'failed'
	startedAt: Date | null;
	completedAt: Date | null;
	totalFiles: number | null;
	processedFiles: number | null;
	totalEntries: number | null;
	processedEntries: number | null;
	errorCount: number | null;
	metadata: string | null;
	parentRunId: string | null;
	rerunType: string | null;
	rerunTargetId: string | null;
	createdAt: Date | null;
}

type RunStatus = "pending" | "running" | "completed" | "failed";

interface IngestionRunCardProps {
	run: IngestionRun;
	onRerun?: (runId: string) => void;
	isRerunning?: boolean;
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

const SOURCE_LABELS: Record<string, string> = {
	cli: "CLI",
	worker: "Worker",
	scheduled: "Scheduled",
};

export function IngestionRunCard({
	run,
	onRerun,
	isRerunning,
}: IngestionRunCardProps) {
	const status = run.status as RunStatus;
	const StatusIcon = STATUS_ICONS[status] || Clock;
	const totalFiles = run.totalFiles ?? 0;
	const processedFiles = run.processedFiles ?? 0;
	const progress =
		totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;

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
		if (hours > 0) return `${hours}h ${minutes % 60}m`;
		if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
		return `${seconds}s`;
	};

	return (
		<Card className="hover:shadow-md transition-shadow">
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<a href={`/admin/ingestion/${run.id}`} className="hover:underline">
						<CardTitle className="flex items-center gap-2 text-base">
							<PlayCircle className="h-4 w-4" />
							{run.chainSlug}
							{run.parentRunId && (
								<span className="text-xs text-muted-foreground">(rerun)</span>
							)}
						</CardTitle>
					</a>
					<div className="flex items-center gap-2">
						<Badge variant="outline">
							{SOURCE_LABELS[run.source] || run.source}
						</Badge>
						<Badge
							variant={STATUS_COLORS[status] || "secondary"}
							className={status === "running" ? "animate-pulse" : ""}
						>
							<StatusIcon
								className={`mr-1 h-3 w-3 ${status === "running" ? "animate-spin" : ""}`}
							/>
							{status}
						</Badge>
					</div>
				</div>
				<CardDescription className="font-mono text-xs">
					{run.id}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="space-y-3">
					{/* Progress Bar */}
					{status === "running" && totalFiles > 0 && (
						<div>
							<div className="flex justify-between text-xs text-muted-foreground mb-1">
								<span>Progress</span>
								<span>
									{processedFiles} / {totalFiles} files ({progress}%)
								</span>
							</div>
							<div className="h-2 bg-muted rounded-full overflow-hidden">
								<div
									className="h-full bg-primary transition-all duration-300"
									style={{ width: `${progress}%` }}
								/>
							</div>
						</div>
					)}

					{/* Stats Grid */}
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
						<div>
							<span className="text-muted-foreground">Files</span>
							<p className="font-medium">
								{processedFiles} / {totalFiles}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Entries</span>
							<p className="font-medium">
								{(run.processedEntries ?? 0).toLocaleString()} /{" "}
								{(run.totalEntries ?? 0).toLocaleString()}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Errors</span>
							<p
								className={`font-medium ${(run.errorCount ?? 0) > 0 ? "text-destructive" : ""}`}
							>
								{run.errorCount ?? 0}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Duration</span>
							<p className="font-medium">
								{formatDuration(run.startedAt, run.completedAt)}
							</p>
						</div>
					</div>

					{/* Timestamps */}
					<div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
						<span>Started: {formatDate(run.startedAt)}</span>
						{run.completedAt && (
							<span>Completed: {formatDate(run.completedAt)}</span>
						)}
					</div>

					{/* Rerun Button */}
					{(status === "completed" || status === "failed") && onRerun && (
						<div className="pt-2">
							<RerunButton
								onRerun={() => onRerun(run.id)}
								isLoading={isRerunning}
								label="Rerun"
							/>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
