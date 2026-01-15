import {
	CheckCircle,
	Clock,
	Database,
	Loader2,
	Package,
	XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { RerunButton } from "./RerunButton";

export interface IngestionChunk {
	id: string;
	fileId: string;
	chunkIndex: number;
	startRow: number;
	endRow: number;
	rowCount: number;
	status: string; // 'pending' | 'processing' | 'completed' | 'failed'
	r2Key: string | null;
	persistedCount: number | null;
	errorCount: number | null;
	processedAt: Date | null;
	createdAt: Date | null;
}

type ChunkStatus = "pending" | "processing" | "completed" | "failed";

interface IngestionChunkListProps {
	chunks: IngestionChunk[];
	isLoading: boolean;
	onRerunChunk?: (chunkId: string) => void;
	isRerunning?: boolean;
	rerunningChunkId?: string | null;
}

const STATUS_ICONS: Record<ChunkStatus, typeof Clock> = {
	pending: Clock,
	processing: Loader2,
	completed: CheckCircle,
	failed: XCircle,
};

const STATUS_COLORS: Record<
	ChunkStatus,
	"secondary" | "default" | "destructive"
> = {
	pending: "secondary",
	processing: "default",
	completed: "default",
	failed: "destructive",
};

export function IngestionChunkList({
	chunks,
	isLoading,
	onRerunChunk,
	isRerunning,
	rerunningChunkId,
}: IngestionChunkListProps) {
	const formatTimeAgo = (date: Date | null) => {
		if (!date) return "Never";
		const now = new Date();
		const diff = now.getTime() - new Date(date).getTime();
		const minutes = Math.floor(diff / (1000 * 60));
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);
		if (days > 0) return `${days}d ago`;
		if (hours > 0) return `${hours}h ago`;
		if (minutes > 0) return `${minutes}m ago`;
		return "Just now";
	};

	if (isLoading) {
		return (
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Chunk</TableHead>
							<TableHead>Rows</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Persisted</TableHead>
							<TableHead>Errors</TableHead>
							<TableHead>Processed</TableHead>
							<TableHead className="w-[80px]">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{[...Array(5)].map((_, i) => (
							<TableRow key={`skeleton-${i}`}>
								<TableCell colSpan={7}>
									<div className="h-8 bg-muted animate-pulse rounded" />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		);
	}

	if (chunks.length === 0) {
		return (
			<div className="rounded-md border py-12 text-center">
				<Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
				<p className="text-muted-foreground">No chunks found for this file</p>
			</div>
		);
	}

	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Chunk</TableHead>
						<TableHead>Rows</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Persisted</TableHead>
						<TableHead>Errors</TableHead>
						<TableHead>Processed</TableHead>
						<TableHead className="w-[80px]">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{chunks.map((chunk) => {
						const status = chunk.status as ChunkStatus;
						const StatusIcon = STATUS_ICONS[status] || Clock;
						const persistedCount = chunk.persistedCount ?? 0;
						const errorCount = chunk.errorCount ?? 0;
						const successRate =
							chunk.rowCount > 0
								? Math.round((persistedCount / chunk.rowCount) * 100)
								: 0;

						return (
							<TableRow key={chunk.id}>
								<TableCell>
									<div className="flex items-center gap-2">
										<Database className="h-4 w-4 text-muted-foreground" />
										<div>
											<span className="font-medium">
												Chunk {chunk.chunkIndex + 1}
											</span>
											<p className="text-xs text-muted-foreground font-mono">
												{chunk.id}
											</p>
										</div>
									</div>
								</TableCell>
								<TableCell>
									<div className="text-sm">
										<span className="font-medium">
											{chunk.rowCount.toLocaleString()}
										</span>
										<span className="text-muted-foreground"> rows</span>
										<p className="text-xs text-muted-foreground">
											{chunk.startRow.toLocaleString()} -{" "}
											{chunk.endRow.toLocaleString()}
										</p>
									</div>
								</TableCell>
								<TableCell>
									<Badge
										variant={STATUS_COLORS[status] || "secondary"}
										className={status === "processing" ? "animate-pulse" : ""}
									>
										<StatusIcon
											className={`mr-1 h-3 w-3 ${status === "processing" ? "animate-spin" : ""}`}
										/>
										{status}
									</Badge>
								</TableCell>
								<TableCell>
									<div className="w-24">
										<div className="flex justify-between text-xs text-muted-foreground mb-1">
											<span>{persistedCount.toLocaleString()}</span>
											<span>{successRate}%</span>
										</div>
										<div className="h-1.5 bg-muted rounded-full overflow-hidden">
											<div
												className={`h-full transition-all duration-300 ${
													status === "failed"
														? "bg-destructive"
														: "bg-green-500"
												}`}
												style={{ width: `${successRate}%` }}
											/>
										</div>
									</div>
								</TableCell>
								<TableCell>
									<span
										className={`font-medium ${errorCount > 0 ? "text-destructive" : "text-muted-foreground"}`}
									>
										{errorCount.toLocaleString()}
									</span>
								</TableCell>
								<TableCell>
									<span className="text-sm text-muted-foreground">
										{formatTimeAgo(chunk.processedAt)}
									</span>
								</TableCell>
								<TableCell>
									{onRerunChunk &&
										(status === "completed" || status === "failed") && (
											<RerunButton
												onRerun={() => onRerunChunk(chunk.id)}
												isLoading={isRerunning && rerunningChunkId === chunk.id}
												size="sm"
											/>
										)}
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}
