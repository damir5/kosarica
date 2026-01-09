import { ArrowRight, Check, Store } from "lucide-react";
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
	onConfirm: () => Promise<void>;
	isLoading?: boolean;
}

export function StoreApprovalModal({
	store,
	open,
	onOpenChange,
	onConfirm,
	isLoading,
}: StoreApprovalModalProps) {
	if (!store) return null;

	const handleConfirm = async () => {
		await onConfirm();
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
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
					<Button variant="outline" onClick={() => onOpenChange(false)}>
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
