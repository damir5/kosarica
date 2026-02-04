import {
	AlertTriangle,
	CheckCircle,
	Clock,
	Loader2,
	Pause,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function TaskStatusBadge({ status }: { status: string }) {
	switch (status) {
		case "processing":
			return (
				<Badge
					variant="secondary"
					className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
				>
					<Loader2 className="mr-1 h-3 w-3 animate-spin" />
					Processing
				</Badge>
			);
		case "claimed":
			return (
				<Badge
					variant="secondary"
					className="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
				>
					<Clock className="mr-1 h-3 w-3" />
					Claimed
				</Badge>
			);
		case "pending":
			return (
				<Badge variant="outline">
					<Clock className="mr-1 h-3 w-3" />
					Pending
				</Badge>
			);
		case "completed":
			return (
				<Badge
					variant="secondary"
					className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
				>
					<CheckCircle className="mr-1 h-3 w-3" />
					Completed
				</Badge>
			);
		case "failed":
			return (
				<Badge
					variant="secondary"
					className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
				>
					<AlertTriangle className="mr-1 h-3 w-3" />
					Failed
				</Badge>
			);
		case "cancelled":
			return (
				<Badge
					variant="secondary"
					className="bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-300"
				>
					<Pause className="mr-1 h-3 w-3" />
					Cancelled
				</Badge>
			);
		case "waiting_for_children":
			return (
				<Badge variant="secondary" className="bg-amber-100 text-amber-800">
					<Clock className="mr-1 h-3 w-3" />
					Waiting
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}
