import { Badge } from "@/components/ui/badge";

type StoreStatus =
	| "pending"
	| "enriched"
	| "needs_review"
	| "approved"
	| "active"
	| "rejected"
	| "merged"
	| "failed";

const STATUS_LABELS: Record<StoreStatus, string> = {
	pending: "Pending",
	enriched: "Enriched",
	needs_review: "Needs Review",
	approved: "Approved",
	active: "Active",
	rejected: "Rejected",
	merged: "Merged",
	failed: "Failed",
};

const STATUS_STYLES: Record<StoreStatus, string> = {
	pending:
		"bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
	enriched:
		"bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
	needs_review:
		"bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800",
	approved:
		"bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
	active:
		"bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
	rejected:
		"bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
	merged:
		"bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800",
	failed:
		"bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400 dark:border-gray-800",
};

interface StoreStatusBadgeProps {
	status: StoreStatus | string | null;
	className?: string;
}

export function StoreStatusBadge({ status, className }: StoreStatusBadgeProps) {
	const normalizedStatus = (status?.toLowerCase() || "pending") as StoreStatus;
	const label = STATUS_LABELS[normalizedStatus] || status || "Unknown";
	const statusStyle = STATUS_STYLES[normalizedStatus] || STATUS_STYLES.pending;

	return (
		<Badge
			variant="outline"
			className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full ${statusStyle} ${className || ""}`}
		>
			{label}
		</Badge>
	);
}
