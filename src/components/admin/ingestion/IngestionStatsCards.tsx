import {
	Activity,
	AlertTriangle,
	CheckCircle,
	Clock,
	Database,
	FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface IngestionStats {
	timeRange: "24h" | "7d" | "30d";
	runs: {
		total: number;
		pending: number;
		running: number;
		completed: number;
		failed: number;
	};
	files: {
		total: number;
		processed: number;
	};
	entries: {
		total: number;
		processed: number;
	};
	errors: {
		total: number;
		byType: Record<string, number>;
		bySeverity: Record<string, number>;
	};
}

interface IngestionStatsCardsProps {
	stats: IngestionStats | undefined;
	isLoading: boolean;
}

export function IngestionStatsCards({
	stats,
	isLoading,
}: IngestionStatsCardsProps) {
	if (isLoading) {
		return (
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				{[...Array(4)].map((_, i) => (
					<Card key={i}>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="font-medium text-sm">Loading...</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="h-8 bg-muted animate-pulse rounded" />
						</CardContent>
					</Card>
				))}
			</div>
		);
	}

	const runsToday = stats?.runs.total ?? 0;
	const filesProcessed = stats?.files.processed ?? 0;
	const totalErrors = stats?.errors.total ?? 0;
	const rowsIngested = stats?.entries.processed ?? 0;

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			{/* Runs Today */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="font-medium text-sm">Runs</CardTitle>
					<Activity className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="font-bold text-2xl">{runsToday}</div>
					<div className="flex items-center gap-2 mt-1">
						{(stats?.runs.running ?? 0) > 0 && (
							<span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
								<Clock className="h-3 w-3 animate-pulse" />
								{stats?.runs.running} running
							</span>
						)}
						{(stats?.runs.completed ?? 0) > 0 && (
							<span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
								<CheckCircle className="h-3 w-3" />
								{stats?.runs.completed} completed
							</span>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Files Processed */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="font-medium text-sm">Files Processed</CardTitle>
					<FileText className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="font-bold text-2xl">
						{filesProcessed.toLocaleString()}
					</div>
					<p className="text-xs text-muted-foreground">
						of {(stats?.files.total ?? 0).toLocaleString()} total files
					</p>
				</CardContent>
			</Card>

			{/* Errors */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="font-medium text-sm">Errors</CardTitle>
					<AlertTriangle className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div
						className={`font-bold text-2xl ${totalErrors > 0 ? "text-destructive" : ""}`}
					>
						{totalErrors.toLocaleString()}
					</div>
					{totalErrors > 0 && stats?.errors.bySeverity && (
						<div className="flex items-center gap-2 mt-1 text-xs">
							{stats.errors.bySeverity.critical && (
								<span className="text-red-600 dark:text-red-400">
									{stats.errors.bySeverity.critical} critical
								</span>
							)}
							{stats.errors.bySeverity.error && (
								<span className="text-orange-600 dark:text-orange-400">
									{stats.errors.bySeverity.error} errors
								</span>
							)}
							{stats.errors.bySeverity.warning && (
								<span className="text-yellow-600 dark:text-yellow-400">
									{stats.errors.bySeverity.warning} warnings
								</span>
							)}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Rows Ingested */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="font-medium text-sm">Rows Ingested</CardTitle>
					<Database className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="font-bold text-2xl">
						{rowsIngested.toLocaleString()}
					</div>
					<p className="text-xs text-muted-foreground">
						of {(stats?.entries.total ?? 0).toLocaleString()} total entries
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
