import {
	AlertCircle,
	CheckCircle2,
	Clock,
	Loader2,
	MapPin,
	RefreshCw,
	XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export interface EnrichmentTask {
	id: string;
	storeId: string;
	type: "geocode" | "verify_address" | "ai_categorize";
	status: "pending" | "processing" | "completed" | "failed";
	inputData: string | null;
	outputData: string | null;
	confidence: string | null;
	verifiedBy: string | null;
	verifiedAt: Date | null;
	errorMessage: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
}

interface EnrichmentTaskCardProps {
	task: EnrichmentTask;
	onVerify?: (task: EnrichmentTask) => void;
	onRetry?: (task: EnrichmentTask) => void;
	isRetrying?: boolean;
}

const STATUS_ICONS = {
	pending: Clock,
	processing: Loader2,
	completed: CheckCircle2,
	failed: XCircle,
};

const STATUS_COLORS = {
	pending: "secondary",
	processing: "default",
	completed: "default",
	failed: "destructive",
} as const;

const TYPE_LABELS = {
	geocode: "Geocoding",
	verify_address: "Address Verification",
	ai_categorize: "AI Categorization",
};

const CONFIDENCE_COLORS = {
	high: "default",
	medium: "secondary",
	low: "outline",
} as const;

export function EnrichmentTaskCard({
	task,
	onVerify,
	onRetry,
	isRetrying,
}: EnrichmentTaskCardProps) {
	const StatusIcon = STATUS_ICONS[task.status];
	const outputData = task.outputData ? JSON.parse(task.outputData) : null;

	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<CardTitle className="flex items-center gap-2 text-base">
						<MapPin className="h-4 w-4" />
						{TYPE_LABELS[task.type]}
					</CardTitle>
					<div className="flex items-center gap-2">
						{task.confidence && (
							<Badge
								variant={
									CONFIDENCE_COLORS[
										task.confidence as keyof typeof CONFIDENCE_COLORS
									] || "outline"
								}
							>
								{task.confidence} confidence
							</Badge>
						)}
						<Badge
							variant={STATUS_COLORS[task.status]}
							className={task.status === "processing" ? "animate-pulse" : ""}
						>
							<StatusIcon
								className={`mr-1 h-3 w-3 ${task.status === "processing" ? "animate-spin" : ""}`}
							/>
							{task.status}
						</Badge>
					</div>
				</div>
				<CardDescription>
					Created{" "}
					{task.createdAt
						? new Date(task.createdAt).toLocaleString()
						: "unknown"}
					{task.verifiedAt && (
						<span className="ml-2">
							| Verified {new Date(task.verifiedAt).toLocaleString()}
						</span>
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{/* Error Message with Retry */}
				{task.status === "failed" && (
					<div className="mb-4 rounded-md bg-destructive/10 border border-destructive/30 p-3">
						<div className="flex items-start justify-between gap-3">
							<div className="flex items-start gap-2">
								<AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
								<div>
									<p className="text-sm font-medium text-destructive">Enrichment Failed</p>
									{task.errorMessage && (
										<p className="text-sm text-destructive/80 mt-1">{task.errorMessage}</p>
									)}
								</div>
							</div>
							{onRetry && (
								<Button
									size="sm"
									variant="outline"
									onClick={() => onRetry(task)}
									disabled={isRetrying}
									className="shrink-0"
								>
									{isRetrying ? (
										<Loader2 className="h-3 w-3 mr-1 animate-spin" />
									) : (
										<RefreshCw className="h-3 w-3 mr-1" />
									)}
									Retry
								</Button>
							)}
						</div>
					</div>
				)}

				{/* Geocode Results */}
				{task.type === "geocode" &&
					task.status === "completed" &&
					outputData && (
						<div className="space-y-3">
							{outputData.found ? (
								<>
									<div className="grid gap-2 sm:grid-cols-2">
										<div>
											<span className="text-xs font-medium text-muted-foreground">
												Latitude
											</span>
											<p className="font-mono text-sm">{outputData.lat}</p>
										</div>
										<div>
											<span className="text-xs font-medium text-muted-foreground">
												Longitude
											</span>
											<p className="font-mono text-sm">{outputData.lon}</p>
										</div>
									</div>
									{outputData.displayName && (
										<div>
											<span className="text-xs font-medium text-muted-foreground">
												Matched Address
											</span>
											<p className="text-sm text-muted-foreground">
												{outputData.displayName}
											</p>
										</div>
									)}
									{/* Map link */}
									<a
										href={`https://www.openstreetmap.org/?mlat=${outputData.lat}&mlon=${outputData.lon}&zoom=17`}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
									>
										View on map
										<MapPin className="h-3 w-3" />
									</a>
								</>
							) : (
								<div className="flex items-center gap-2 text-muted-foreground">
									<AlertCircle className="h-4 w-4" />
									<p className="text-sm">
										No geocoding results found for this address
									</p>
								</div>
							)}
						</div>
					)}

				{/* Address Verification Results */}
				{task.type === "verify_address" &&
					task.status === "completed" &&
					outputData && (
						<div className="space-y-3">
							{outputData.needsReview && (
								<div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-500">
									<AlertCircle className="h-4 w-4" />
									<p className="text-sm">Address needs manual review</p>
								</div>
							)}
							<div className="grid gap-2">
								<div>
									<span className="text-xs font-medium text-muted-foreground">
										Original Address
									</span>
									<p className="text-sm">
										{outputData.originalAddress || "Not set"}
									</p>
								</div>
								<div className="grid gap-2 sm:grid-cols-2">
									<div>
										<span className="text-xs font-medium text-muted-foreground">
											City
										</span>
										<p className="text-sm">{outputData.city || "Not set"}</p>
									</div>
									<div>
										<span className="text-xs font-medium text-muted-foreground">
											Postal Code
										</span>
										<p className="text-sm">
											{outputData.postalCode || "Not set"}
										</p>
									</div>
								</div>
							</div>
						</div>
					)}

				{/* AI Categorization Results */}
				{task.type === "ai_categorize" &&
					task.status === "completed" &&
					outputData && (
						<div className="text-sm text-muted-foreground">
							{outputData.message || "No categorization data available"}
						</div>
					)}

				{/* Verification Actions */}
				{task.status === "completed" && !task.verifiedAt && onVerify && (
					<div className="mt-4 pt-4 border-t">
						<Button onClick={() => onVerify(task)} size="sm">
							Review & Verify
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
