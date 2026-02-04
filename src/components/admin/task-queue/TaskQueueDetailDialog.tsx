import { AlertTriangle, CalendarClock, RotateCcw, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyableCell } from "@/components/ui/copyable-cell";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TaskStatusBadge } from "./TaskStatusBadge";

export type TaskQueueRow = {
	id: string;
	taskType: string;
	payload: unknown;
	priority: number | null;
	status: string;
	scheduledFor: Date | null;
	startedAt: Date | null;
	completedAt: Date | null;
	failedAt: Date | null;
	workerId: string | null;
	retryCount: number | null;
	maxRetries: number | null;
	errorMessage: string | null;
	parentTaskId: string | null;
	expectedChildren: number | null;
	completedChildren: number | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};

export function TaskQueueDetailDialog({
	open,
	onOpenChange,
	task,
	onCancel,
	onRequeue,
	onReschedule,
	actionsDisabled,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	task: TaskQueueRow | null;
	onCancel: (taskId: string) => void;
	onRequeue: (taskId: string) => void;
	onReschedule: (taskId: string, scheduledForIso: string) => void;
	actionsDisabled?: boolean;
}) {
	const [scheduledFor, setScheduledFor] = useState<string>("");
	const [confirmAction, setConfirmAction] = useState<
		| null
		| { type: "cancel" }
		| { type: "requeue" }
		| { type: "reschedule"; scheduledForIso: string }
	>(null);

	const payloadPretty = useMemo(() => {
		if (!task) return "";
		try {
			return JSON.stringify(task.payload, null, 2);
		} catch {
			return String(task.payload);
		}
	}, [task]);

	if (!task) {
		return null;
	}

	const canCancel = task.status === "pending" || task.status === "claimed";
	const canRequeue = task.status === "failed" || task.status === "cancelled";
	const canReschedule = task.status === "pending";

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					setConfirmAction(null);
				}
				onOpenChange(nextOpen);
			}}
		>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						Task
						<Badge variant="outline" className="font-mono">
							{task.id}
						</Badge>
						<TaskStatusBadge status={task.status} />
					</DialogTitle>
					<DialogDescription>
						Type: <span className="font-mono">{task.taskType}</span>
					</DialogDescription>
				</DialogHeader>

				<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
					<div className="space-y-3">
						<div className="rounded-md border border-border bg-card p-3">
							<p className="text-xs text-muted-foreground">Identifiers</p>
							<div className="mt-2 space-y-1">
								<CopyableCell value={task.id} label="Task ID" mono />
								{task.workerId && (
									<CopyableCell value={task.workerId} label="Worker" mono />
								)}
								{task.parentTaskId && (
									<CopyableCell
										value={task.parentTaskId}
										label="Parent Task"
										mono
									/>
								)}
							</div>
						</div>

						<div className="rounded-md border border-border bg-card p-3">
							<p className="text-xs text-muted-foreground">Timing</p>
							<div className="mt-2 space-y-1 text-sm">
								<Row label="Scheduled">
									{task.scheduledFor ? task.scheduledFor.toLocaleString() : "-"}
								</Row>
								<Row label="Started">
									{task.startedAt ? task.startedAt.toLocaleString() : "-"}
								</Row>
								<Row label="Completed">
									{task.completedAt ? task.completedAt.toLocaleString() : "-"}
								</Row>
								<Row label="Failed">
									{task.failedAt ? task.failedAt.toLocaleString() : "-"}
								</Row>
								<Row label="Created">
									{task.createdAt ? task.createdAt.toLocaleString() : "-"}
								</Row>
								<Row label="Updated">
									{task.updatedAt ? task.updatedAt.toLocaleString() : "-"}
								</Row>
							</div>
						</div>

						<div className="rounded-md border border-border bg-card p-3">
							<p className="text-xs text-muted-foreground">Execution</p>
							<div className="mt-2 space-y-1 text-sm">
								<Row label="Priority">{String(task.priority ?? 0)}</Row>
								<Row label="Retries">
									{String(task.retryCount ?? 0)} /{" "}
									{String(task.maxRetries ?? 0)}
								</Row>
								<Row label="Children">
									{String(task.completedChildren ?? 0)} /{" "}
									{String(task.expectedChildren ?? 0)}
								</Row>
							</div>
						</div>
					</div>

					<div className="space-y-3">
						<div className="rounded-md border border-border bg-card p-3">
							<div className="flex items-center justify-between">
								<p className="text-xs text-muted-foreground">Payload</p>
								<CopyableCell value={payloadPretty} label="Payload" />
							</div>
							<pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
								{payloadPretty}
							</pre>
						</div>

						{task.errorMessage && (
							<div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
								<div className="flex items-center gap-2 text-sm font-medium">
									<AlertTriangle className="h-4 w-4" />
									Error
								</div>
								<p className="mt-2 whitespace-pre-wrap text-sm">
									{task.errorMessage}
								</p>
							</div>
						)}
					</div>
				</div>

				<DialogFooter className="flex items-center justify-between sm:justify-between">
					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="outline"
							disabled={!canCancel || actionsDisabled}
							onClick={() => setConfirmAction({ type: "cancel" })}
						>
							<XCircle className="mr-1 h-4 w-4" />
							Cancel
						</Button>
						<Button
							variant="outline"
							disabled={!canRequeue || actionsDisabled}
							onClick={() => setConfirmAction({ type: "requeue" })}
						>
							<RotateCcw className="mr-1 h-4 w-4" />
							Requeue
						</Button>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<div className="flex items-center gap-2">
							<Label htmlFor="scheduledFor" className="text-sm">
								Reschedule
							</Label>
							<Input
								id="scheduledFor"
								type="datetime-local"
								className="w-[210px]"
								value={scheduledFor}
								onChange={(e) => setScheduledFor(e.target.value)}
								disabled={!canReschedule || actionsDisabled}
							/>
						</div>
						<Button
							disabled={!canReschedule || actionsDisabled || !scheduledFor}
							onClick={() =>
								setConfirmAction({
									type: "reschedule",
									scheduledForIso: scheduledFor,
								})
							}
						>
							<CalendarClock className="mr-1 h-4 w-4" />
							Set
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>

			{confirmAction && (
				<Dialog open={true} onOpenChange={() => setConfirmAction(null)}>
					<DialogContent className="sm:max-w-lg">
						<DialogHeader>
							<DialogTitle>Confirm Action</DialogTitle>
							<DialogDescription>
								{confirmAction.type === "cancel" && (
									<>Cancel this task? This will set status to cancelled.</>
								)}
								{confirmAction.type === "requeue" && (
									<>
										Requeue this task now? This will set it back to pending and
										clear its error.
									</>
								)}
								{confirmAction.type === "reschedule" && (
									<>
										Reschedule this task to{" "}
										<span className="font-mono">
											{confirmAction.scheduledForIso}
										</span>
										?
									</>
								)}
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button variant="outline" onClick={() => setConfirmAction(null)}>
								Back
							</Button>
							<Button
								variant={
									confirmAction.type === "cancel" ? "destructive" : "default"
								}
								disabled={actionsDisabled}
								onClick={() => {
									const action = confirmAction;
									setConfirmAction(null);
									if (action.type === "cancel") {
										onCancel(task.id);
										return;
									}
									if (action.type === "requeue") {
										onRequeue(task.id);
										return;
									}
									onReschedule(task.id, action.scheduledForIso);
								}}
							>
								Confirm
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</Dialog>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-4">
			<span className="text-muted-foreground">{label}</span>
			<span className="text-right">{children}</span>
		</div>
	);
}
