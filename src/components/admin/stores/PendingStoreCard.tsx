import {
	Check,
	FileSpreadsheet,
	GitMerge,
	Loader2,
	Store,
	X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StoreStatusBadge } from "./StoreStatusBadge";

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

interface PendingStoreCardProps {
	index: number;
	store: PendingStore;
	isSelected?: boolean;
	onSelectionChange?: (selected: boolean) => void;
	onApprove: () => void;
	onMerge: () => void;
	onReject: () => void;
	isRejecting?: boolean;
}

export function PendingStoreCard({
	index,
	store,
	isSelected = false,
	onSelectionChange,
	onApprove,
	onMerge,
	onReject,
	isRejecting,
}: PendingStoreCardProps) {
	// Format the chain name for display
	const chainName = store.chainSlug.toUpperCase();

	// Generate a source file name from store name (for display purposes)
	const sourceFile = `${store.chainSlug}_${store.name.toLowerCase().replace(/\s+/g, "_")}.csv`;

	return (
		<Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
			<CardContent className="pt-6">
				{/* Store Header */}
				<div className="flex items-start justify-between mb-4">
					<div className="flex items-start gap-3">
						{onSelectionChange && (
							<input
								type="checkbox"
								checked={isSelected}
								onChange={(e) => onSelectionChange(e.target.checked)}
								className="mt-1 h-4 w-4 rounded border-border text-amber-600 focus:ring-2 focus:ring-amber-500 focus:ring-offset-0 cursor-pointer"
								aria-label={`Select ${store.name}`}
							/>
						)}
						<div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700 font-medium text-sm dark:bg-amber-900/50 dark:text-amber-400">
							{index}
						</div>
						<div>
							<div className="flex items-center gap-2">
								<Store className="h-4 w-4 text-muted-foreground" />
								<span className="text-sm text-muted-foreground">
									New Store Detected:
								</span>
								<span className="font-semibold text-foreground">
									"{store.name}"
								</span>
								{store.status && <StoreStatusBadge status={store.status} />}
							</div>
							<div className="flex items-center gap-2 mt-1">
								<FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
								<span className="text-sm text-muted-foreground">
									Source File:{" "}
									<span className="font-mono text-xs">{sourceFile}</span>
								</span>
							</div>
							<div className="flex items-center gap-2 mt-1">
								<span className="text-sm text-muted-foreground">
									Detected Chain:
								</span>
								<Badge variant="outline">{chainName}</Badge>
							</div>
						</div>
					</div>
				</div>

				{/* Decision Required Banner */}
				<div className="bg-amber-100 dark:bg-amber-900/30 rounded-md px-3 py-2 mb-4">
					<p className="text-sm font-medium text-amber-800 dark:text-amber-300">
						Decision Required
					</p>
				</div>

				{/* Action Options */}
				<div className="space-y-3">
					{/* Option A: Approve as New Price Source */}
					<div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors">
						<div className="flex-1">
							<div className="flex items-center gap-2 mb-1">
								<span className="text-xs font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
									Option A
								</span>
							</div>
							<p className="text-sm font-medium text-foreground mb-1">
								Approve as New Price Source
							</p>
							<p className="text-xs text-muted-foreground">
								"This is a distinct set of prices (e.g. specific region or
								web-only)."
							</p>
							<p className="text-xs text-muted-foreground mt-1">
								Creates Virtual Store "{store.name}"
							</p>
						</div>
						<Button
							size="sm"
							variant="default"
							onClick={onApprove}
							className="bg-green-600 hover:bg-green-700 text-white"
						>
							<Check className="h-4 w-4 mr-1" />
							Approve
						</Button>
					</div>

					{/* Option B: Merge into Existing Source */}
					<div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors">
						<div className="flex-1">
							<div className="flex items-center gap-2 mb-1">
								<span className="text-xs font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
									Option B
								</span>
							</div>
							<p className="text-sm font-medium text-foreground mb-1">
								Merge into Existing Source
							</p>
							<p className="text-xs text-muted-foreground">
								"This file actually belongs to an existing price list."
							</p>
							<p className="text-xs text-muted-foreground mt-1">
								Map to an existing price source
							</p>
						</div>
						<Button size="sm" variant="secondary" onClick={onMerge}>
							<GitMerge className="h-4 w-4 mr-1" />
							Merge
						</Button>
					</div>

					{/* Option C: Reject & Block */}
					<div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors">
						<div className="flex-1">
							<div className="flex items-center gap-2 mb-1">
								<span className="text-xs font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
									Option C
								</span>
							</div>
							<p className="text-sm font-medium text-foreground mb-1">
								Reject &amp; Block
							</p>
							<p className="text-xs text-muted-foreground">
								"This is garbage data."
							</p>
						</div>
						<Button
							size="sm"
							variant="destructive"
							onClick={onReject}
							disabled={isRejecting}
						>
							{isRejecting ? (
								<>
									<Loader2 className="h-4 w-4 mr-1 animate-spin" />
									Rejecting...
								</>
							) : (
								<>
									<X className="h-4 w-4 mr-1" />
									Reject
								</>
							)}
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
