import { Activity, Clock, ListChecks, TriangleAlert } from "lucide-react";
import { MetricCard } from "@/components/admin/MetricCard";

export type TaskQueueStats = {
	byStatus: Array<{ status: string; count: number }>;
	byType: Array<{ type: string; count: number }>;
	stuck: { claimed: number; processing: number };
	nextPendingAt: Date | null;
};

function getCount(stats: TaskQueueStats | undefined, status: string): number {
	return Number(stats?.byStatus.find((s) => s.status === status)?.count ?? 0);
}

export function TaskQueueStatsCards({
	stats,
}: {
	stats: TaskQueueStats | undefined;
}) {
	const pending = getCount(stats, "pending");
	const claimed = getCount(stats, "claimed");
	const processing = getCount(stats, "processing");
	const failed = getCount(stats, "failed");
	const completed = getCount(stats, "completed");
	const total = Number(
		stats?.byStatus.reduce((acc, s) => acc + (s.count ?? 0), 0) ?? 0,
	);
	const nextPending = stats?.nextPendingAt
		? stats.nextPendingAt.toLocaleString()
		: "-";

	return (
		<div className="grid grid-cols-1 gap-4 md:grid-cols-6">
			<MetricCard
				title="Total"
				value={String(total)}
				description="All tasks in queue"
				icon={<ListChecks className="h-4 w-4" />}
			/>
			<MetricCard
				title="Pending"
				value={String(pending)}
				description={`Next at: ${nextPending}`}
				icon={<Clock className="h-4 w-4" />}
			/>
			<MetricCard
				title="Claimed"
				value={String(claimed)}
				description={`Stuck: ${stats?.stuck.claimed ?? 0}`}
				icon={<Activity className="h-4 w-4" />}
			/>
			<MetricCard
				title="Processing"
				value={String(processing)}
				description={`Stuck: ${stats?.stuck.processing ?? 0}`}
				icon={<Activity className="h-4 w-4" />}
			/>
			<MetricCard
				title="Failed"
				value={String(failed)}
				description="Needs attention"
				icon={<TriangleAlert className="h-4 w-4" />}
			/>
			<MetricCard
				title="Completed"
				value={String(completed)}
				description="Completed tasks"
				icon={<ListChecks className="h-4 w-4" />}
			/>
		</div>
	);
}
