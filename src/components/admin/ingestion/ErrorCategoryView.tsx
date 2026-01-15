import { AlertCircle, AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

interface ErrorStats {
	total: number;
	byType: Record<string, number>;
	bySeverity: Record<string, number>;
}

interface ErrorCategoryViewProps {
	errors: ErrorStats | undefined;
	isLoading?: boolean;
}

const ERROR_TYPE_LABELS: Record<
	string,
	{ label: string; description: string }
> = {
	parse: { label: "Parse Errors", description: "Failed to parse file content" },
	validation: {
		label: "Validation Errors",
		description: "Data validation failures",
	},
	store_resolution: {
		label: "Store Resolution",
		description: "Could not match store identifier",
	},
	persist: {
		label: "Persist Errors",
		description: "Failed to save data to database",
	},
	network: { label: "Network Errors", description: "Network or API failures" },
	unknown: { label: "Unknown Errors", description: "Unclassified errors" },
};

const SEVERITY_CONFIG = {
	critical: {
		icon: AlertOctagon,
		color: "text-red-600 dark:text-red-400",
		bgColor: "bg-red-100 dark:bg-red-900/30",
		borderColor: "border-red-200 dark:border-red-800",
	},
	error: {
		icon: AlertTriangle,
		color: "text-orange-600 dark:text-orange-400",
		bgColor: "bg-orange-100 dark:bg-orange-900/30",
		borderColor: "border-orange-200 dark:border-orange-800",
	},
	warning: {
		icon: AlertCircle,
		color: "text-yellow-600 dark:text-yellow-400",
		bgColor: "bg-yellow-100 dark:bg-yellow-900/30",
		borderColor: "border-yellow-200 dark:border-yellow-800",
	},
	info: {
		icon: Info,
		color: "text-blue-600 dark:text-blue-400",
		bgColor: "bg-blue-100 dark:bg-blue-900/30",
		borderColor: "border-blue-200 dark:border-blue-800",
	},
};

export function ErrorCategoryView({
	errors,
	isLoading,
}: ErrorCategoryViewProps) {
	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<AlertTriangle className="h-5 w-5" />
						Error Categories
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						{[...Array(3)].map((_, i) => (
							<div key={`skeleton-${i}`} className="h-16 bg-muted animate-pulse rounded" />
						))}
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!errors || errors.total === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<AlertTriangle className="h-5 w-5" />
						Error Categories
					</CardTitle>
					<CardDescription>
						Error breakdown by type and severity
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="text-center py-8 text-muted-foreground">
						<AlertTriangle className="h-12 w-12 mx-auto mb-3 opacity-50" />
						<p>No errors recorded</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	const sortedByType = Object.entries(errors.byType).sort(
		([, a], [, b]) => b - a,
	);
	const sortedBySeverity = Object.entries(errors.bySeverity).sort(
		([, a], [, b]) => b - a,
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<AlertTriangle className="h-5 w-5" />
					Error Categories
					<Badge variant="destructive" className="ml-2">
						{errors.total.toLocaleString()} total
					</Badge>
				</CardTitle>
				<CardDescription>Error breakdown by type and severity</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{/* By Severity */}
				<div>
					<h4 className="font-medium text-sm mb-3">By Severity</h4>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						{sortedBySeverity.map(([severity, count]) => {
							const config =
								SEVERITY_CONFIG[severity as keyof typeof SEVERITY_CONFIG] ||
								SEVERITY_CONFIG.error;
							const SeverityIcon = config.icon;
							const percentage = Math.round((count / errors.total) * 100);

							return (
								<div
									key={severity}
									className={`p-3 rounded-lg border ${config.bgColor} ${config.borderColor}`}
								>
									<div className="flex items-center gap-2">
										<SeverityIcon className={`h-4 w-4 ${config.color}`} />
										<span className={`font-medium capitalize ${config.color}`}>
											{severity}
										</span>
									</div>
									<div className="mt-2 flex items-end justify-between">
										<span className="text-2xl font-bold">
											{count.toLocaleString()}
										</span>
										<span className="text-sm text-muted-foreground">
											{percentage}%
										</span>
									</div>
								</div>
							);
						})}
					</div>
				</div>

				{/* By Type */}
				<div>
					<h4 className="font-medium text-sm mb-3">By Type</h4>
					<div className="space-y-2">
						{sortedByType.map(([type, count]) => {
							const typeInfo = ERROR_TYPE_LABELS[type] || {
								label: type,
								description: "Unknown error type",
							};
							const percentage = Math.round((count / errors.total) * 100);

							return (
								<div
									key={type}
									className="flex items-center justify-between p-3 rounded-lg border bg-card"
								>
									<div className="flex-1">
										<div className="flex items-center gap-2">
											<span className="font-medium">{typeInfo.label}</span>
											<Badge variant="outline" className="text-xs">
												{count.toLocaleString()}
											</Badge>
										</div>
										<p className="text-xs text-muted-foreground mt-0.5">
											{typeInfo.description}
										</p>
									</div>
									<div className="w-32 ml-4">
										<div className="flex justify-end text-xs text-muted-foreground mb-1">
											{percentage}%
										</div>
										<div className="h-2 bg-muted rounded-full overflow-hidden">
											<div
												className="h-full bg-destructive transition-all duration-300"
												style={{ width: `${percentage}%` }}
											/>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
