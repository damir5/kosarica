import { AlertCircle, Ban, Check, Loader2, X } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface BulkActionsBarProps {
	selectedCount: number;
	onBulkApprove: (notes?: string) => Promise<void>;
	onBulkReject: (reason?: string) => Promise<void>;
	onClearSelection: () => void;
	isApproving?: boolean;
	isRejecting?: boolean;
	disabled?: boolean;
}

export function BulkActionsBar({
	selectedCount,
	onBulkApprove,
	onBulkReject,
	onClearSelection,
	isApproving = false,
	isRejecting = false,
	disabled = false,
}: BulkActionsBarProps) {
	const [approveModalOpen, setApproveModalOpen] = useState(false);
	const [rejectModalOpen, setRejectModalOpen] = useState(false);
	const [notes, setNotes] = useState("");
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);

	const handleBulkApprove = async () => {
		setError(null);
		try {
			await onBulkApprove(notes.trim() || undefined);
			setApproveModalOpen(false);
			setNotes("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to approve stores");
		}
	};

	const handleBulkReject = async () => {
		setError(null);
		try {
			await onBulkReject(reason.trim() || undefined);
			setRejectModalOpen(false);
			setReason("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to reject stores");
		}
	};

	const handleCloseApproveModal = () => {
		setApproveModalOpen(false);
		setNotes("");
		setError(null);
	};

	const handleCloseRejectModal = () => {
		setRejectModalOpen(false);
		setReason("");
		setError(null);
	};

	return (
		<>
			<div className="sticky bottom-0 z-10 border border-border bg-card/95 backdrop-blur shadow-lg rounded-lg">
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-3">
						<div className="flex items-center gap-2">
							<div className="bg-amber-100 dark:bg-amber-900/30 rounded-full p-1">
								<Check className="h-4 w-4 text-amber-600 dark:text-amber-500" />
							</div>
							<span className="font-medium text-sm">
								{selectedCount} store{selectedCount !== 1 ? "s" : ""} selected
							</span>
						</div>
					</div>

					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={onClearSelection}
							disabled={disabled}
						>
							<X className="h-4 w-4 mr-1" />
							Clear
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setRejectModalOpen(true)}
							disabled={disabled || isRejecting}
							className="text-destructive hover:bg-destructive/10"
						>
							{isRejecting ? (
								<Loader2 className="h-4 w-4 mr-1 animate-spin" />
							) : (
								<Ban className="h-4 w-4 mr-1" />
							)}
							Reject All
						</Button>
						<Button
							size="sm"
							onClick={() => setApproveModalOpen(true)}
							disabled={disabled || isApproving}
							className="bg-green-600 hover:bg-green-700 text-white"
						>
							{isApproving ? (
								<Loader2 className="h-4 w-4 mr-1 animate-spin" />
							) : (
								<Check className="h-4 w-4 mr-1" />
							)}
							Approve All
						</Button>
					</div>
				</div>
			</div>

			{/* Approve Confirmation Modal */}
			<Dialog open={approveModalOpen} onOpenChange={handleCloseApproveModal}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Check className="h-5 w-5 text-green-600" />
							Approve {selectedCount} Store{selectedCount !== 1 ? "s" : ""}
						</DialogTitle>
						<DialogDescription>
							Are you sure you want to approve {selectedCount} store
							{selectedCount !== 1 ? "s" : ""} as new price source
							{selectedCount !== 1 ? "s" : ""}?
						</DialogDescription>
					</DialogHeader>

					<div className="py-4 space-y-4">
						{error && (
							<Alert variant="destructive">
								<AlertCircle className="h-4 w-4" />
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						)}

						<div className="space-y-2">
							<label
								htmlFor="approval-notes"
								className="text-sm font-medium text-foreground"
							>
								Approval Notes (Optional)
							</label>
							<Textarea
								id="approval-notes"
								value={notes}
								onChange={(e) => setNotes(e.target.value)}
								placeholder="Add any notes about this bulk approval..."
								className="min-h-[80px] resize-none"
							/>
							<p className="text-xs text-muted-foreground">
								Notes will be applied to all stores for audit purposes
							</p>
						</div>

						<div className="rounded-lg border border-border bg-muted/50 p-3">
							<p className="text-sm font-medium text-foreground mb-1">
								What will happen:
							</p>
							<ul className="text-sm text-muted-foreground space-y-1">
								<li>
									• {selectedCount} new virtual store
									{selectedCount !== 1 ? "s" : ""} will be created
								</li>
								<li>
									• All stores will change from "pending" to "active" status
								</li>
								<li>• Prices from these sources will be tracked separately</li>
							</ul>
						</div>
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={handleCloseApproveModal}>
							Cancel
						</Button>
						<Button
							onClick={handleBulkApprove}
							disabled={isApproving}
							className="bg-green-600 hover:bg-green-700 text-white"
						>
							{isApproving ? (
								<>
									<Loader2 className="h-4 w-4 mr-1 animate-spin" />
									Approving...
								</>
							) : (
								<>
									<Check className="h-4 w-4 mr-1" />
									Approve {selectedCount}
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Reject Confirmation Modal */}
			<Dialog open={rejectModalOpen} onOpenChange={handleCloseRejectModal}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Ban className="h-5 w-5 text-destructive" />
							Reject {selectedCount} Store{selectedCount !== 1 ? "s" : ""}
						</DialogTitle>
						<DialogDescription>
							Are you sure you want to reject {selectedCount} store
							{selectedCount !== 1 ? "s" : ""}?
						</DialogDescription>
					</DialogHeader>

					<div className="py-4 space-y-4">
						{error && (
							<Alert variant="destructive">
								<AlertCircle className="h-4 w-4" />
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						)}

						<div className="space-y-2">
							<label
								htmlFor="rejection-reason"
								className="text-sm font-medium text-foreground"
							>
								Rejection Reason (Optional)
							</label>
							<Textarea
								id="rejection-reason"
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								placeholder="Why are these stores being rejected? (e.g., duplicate data, invalid locations...)"
								className="min-h-[80px] resize-none"
							/>
							<p className="text-xs text-muted-foreground">
								This will help improve future data detection
							</p>
						</div>

						<Alert variant="destructive">
							<AlertCircle className="h-4 w-4" />
							<AlertDescription>
								<strong>Warning:</strong> This action cannot be undone. All{" "}
								{selectedCount} store{selectedCount !== 1 ? "s" : ""} will be
								permanently deleted.
							</AlertDescription>
						</Alert>
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={handleCloseRejectModal}>
							Cancel
						</Button>
						<Button
							onClick={handleBulkReject}
							disabled={isRejecting}
							variant="destructive"
						>
							{isRejecting ? (
								<>
									<Loader2 className="h-4 w-4 mr-1 animate-spin" />
									Rejecting...
								</>
							) : (
								<>
									<Ban className="h-4 w-4 mr-1" />
									Reject {selectedCount}
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
