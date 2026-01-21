import { AlertCircle, AlertTriangle, ArrowRight, Check, FileText, RefreshCw, Store } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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

type PendingStore = {
	id: string;
	chainSlug: string;
	name: string;
	address: string | null;
	city: string | null;
	postalCode: string | null;
	latitude: string | null;
	longitude: string | null;
	isVirtual: boolean | null;
	priceSourceStoreId: string | null;
	status: string | null;
	createdAt: Date | null;
	updatedAt: Date | null;
};

interface StoreApprovalModalProps {
	store: PendingStore | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (notes?: string) => Promise<void>;
	isLoading?: boolean;
	error?: string | null;
	onClearError?: () => void;
}

export function StoreApprovalModal({
	store,
	open,
	onOpenChange,
	onConfirm,
	isLoading,
	error,
	onClearError,
}: StoreApprovalModalProps) {
	const [notes, setNotes] = useState("");

	const isConflictError = error?.includes("modified by someone else") || error?.includes("refresh");

	const handleClearError = () => {
		if (onClearError) onClearError();
	};

	if (!store) return null;

	const handleConfirm = async () => {
		await onConfirm(notes.trim() || undefined);
		setNotes(""); // Reset notes after confirm
	};

	const handleOpenChange = (open: boolean) => {
		if (!open) {
			setNotes(""); // Reset notes when closing
			handleClearError(); // Clear error when closing
		}
		onOpenChange(open);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Check className="h-5 w-5 text-green-600" />
						Approve as New Price Source
					</DialogTitle>
					<DialogDescription>
						This will create a new virtual store that represents a distinct
						price source.
					</DialogDescription>
				</DialogHeader>

				{/* Error Display */}
				{error && (
					<div className={`rounded-md border p-3 ${
						isConflictError
							? "bg-amber-50/50 border-amber-300 dark:bg-amber-950/20 dark:border-amber-800"
							: "bg-destructive/10 border-destructive/30"
					}`}>
						<div className="flex items-start gap-3">
							{isConflictError ? (
								<AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
							) : (
								<AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
							)}
							<div className="flex-1">
								<p className={`text-sm font-medium ${
									isConflictError
										? "text-amber-800 dark:text-amber-300"
										: "text-destructive"
								}`}>
									{isConflictError ? "Concurrent Modification Detected" : "Error"}
								</p>
								<p className={`text-sm mt-1 ${
									isConflictError
										? "text-amber-700 dark:text-amber-400"
										: "text-destructive"
								}`}>
									{error}
								</p>
							</div>
						</div>
					</div>
				)}

				<div className="py-4 space-y-4">
					{/* Store Info */}
					<div className="rounded-lg border border-border bg-muted/50 p-4">
						<div className="flex items-center gap-2 mb-2">
							<Store className="h-4 w-4 text-muted-foreground" />
							<span className="text-sm font-medium">{store.name}</span>
						</div>
						<div className="flex items-center gap-2">
							<span className="text-xs text-muted-foreground">Chain:</span>
							<Badge variant="outline" className="text-xs">
								{store.chainSlug.toUpperCase()}
							</Badge>
						</div>
					</div>

					{/* Approval Notes */}
					<div className="space-y-2">
						<label className="text-sm font-medium text-foreground flex items-center gap-1.5">
							<FileText className="h-3.5 w-3.5" />
							Approval Notes (Optional)
						</label>
						<Textarea
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							placeholder="Add any notes about this approval (e.g., why this store was approved, any special handling needed)..."
							className="min-h-[80px] resize-none"
						/>
						<p className="text-xs text-muted-foreground">
							Notes will be saved for audit purposes
						</p>
					</div>

					{/* What Will Happen */}
					<div className="space-y-2">
						<p className="text-sm font-medium text-foreground">
							What will happen:
						</p>
						<ul className="text-sm text-muted-foreground space-y-1">
							<li className="flex items-start gap-2">
								<ArrowRight className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
								<span>
									A new virtual store <strong>"{store.name}"</strong> will be
									created
								</span>
							</li>
							<li className="flex items-start gap-2">
								<ArrowRight className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
								<span>
									The store status will change from "pending" to "active"
								</span>
							</li>
							<li className="flex items-start gap-2">
								<ArrowRight className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
								<span>Prices from this source will be tracked separately</span>
							</li>
							<li className="flex items-start gap-2">
								<ArrowRight className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
								<span>
									Physical locations can be linked to this price source
								</span>
							</li>
						</ul>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={handleConfirm}
						disabled={isLoading}
						className="bg-green-600 hover:bg-green-700 text-white"
					>
						{isLoading ? "Approving..." : "Approve Store"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
