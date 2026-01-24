import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, GitMerge, Store } from "lucide-react";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { orpc } from "@/orpc/client";

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

type TargetStore = {
	id: string;
	name: string;
	updatedAt: Date | null;
};

interface StoreMergeModalProps {
	store: PendingStore | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (
		targetStoreId: string,
		targetStore: TargetStore | null,
	) => Promise<void>;
	isLoading?: boolean;
}

export function StoreMergeModal({
	store,
	open,
	onOpenChange,
	onConfirm,
	isLoading,
}: StoreMergeModalProps) {
	const [selectedTargetId, setSelectedTargetId] = useState<string>("");

	// Query virtual stores for merging options
	const { data: targetOptions, isLoading: loadingTargets } = useQuery(
		orpc.admin.stores.getVirtualStoresForLinking.queryOptions({
			input: { chainSlug: store?.chainSlug || "" },
		}),
	);

	// Query the selected target store for full details (for optimistic locking)
	const { data: selectedTargetData } = useQuery(
		orpc.admin.stores.get.queryOptions({
			input: { storeId: selectedTargetId },
		}),
	);

	// Reset selection when modal closes
	const handleOpenChange = (newOpen: boolean) => {
		if (!newOpen) {
			setSelectedTargetId("");
		}
		onOpenChange(newOpen);
	};

	if (!store) return null;

	const handleConfirm = async () => {
		if (selectedTargetId) {
			// Pass the full target store for optimistic locking
			await onConfirm(selectedTargetId, selectedTargetData ?? null);
			setSelectedTargetId("");
		}
	};

	// Use targetOptions which returns { id, name } for each store
	// Note: The linking API returns minimal info, we'll fetch full details on selection
	const availableStores: Array<{ id: string; name: string }> =
		targetOptions?.stores ?? [];

	// Get selected store name for display
	const selectedStoreName = availableStores.find(
		(s) => s.id === selectedTargetId,
	)?.name;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<GitMerge className="h-5 w-5 text-blue-600" />
						Merge into Existing Source
					</DialogTitle>
					<DialogDescription>
						Map this store's data to an existing price source. The pending store
						will be removed and its data will be associated with the target.
					</DialogDescription>
				</DialogHeader>

				<div className="py-4 space-y-4">
					{/* Source Store Info */}
					<div className="rounded-lg border border-border bg-muted/50 p-4">
						<div className="flex items-center gap-2 mb-2">
							<Store className="h-4 w-4 text-muted-foreground" />
							<span className="text-sm text-muted-foreground">Merging:</span>
							<span className="text-sm font-medium">{store.name}</span>
						</div>
						<div className="flex items-center gap-2">
							<span className="text-xs text-muted-foreground">Chain:</span>
							<Badge variant="outline" className="text-xs">
								{store.chainSlug.toUpperCase()}
							</Badge>
						</div>
					</div>

					{/* Target Store Selection */}
					<div className="space-y-2">
						<p className="text-sm font-medium text-foreground">
							Select Target Price Source
						</p>
						<Select
							value={selectedTargetId}
							onValueChange={setSelectedTargetId}
						>
							<SelectTrigger>
								<SelectValue
									placeholder={
										loadingTargets ? "Loading..." : "Select a price source..."
									}
								/>
							</SelectTrigger>
							<SelectContent>
								{availableStores.length === 0 ? (
									<div className="py-4 px-2 text-sm text-muted-foreground text-center">
										No active price sources available for this chain
									</div>
								) : (
									availableStores.map((targetStore) => (
										<SelectItem key={targetStore.id} value={targetStore.id}>
											{targetStore.name}
										</SelectItem>
									))
								)}
							</SelectContent>
						</Select>

						{availableStores.length === 0 && !loadingTargets && (
							<div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50">
								<AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
								<p className="text-sm text-amber-800 dark:text-amber-300">
									No active price sources found for{" "}
									{store.chainSlug.toUpperCase()}. You may need to approve
									another store first, or use "Approve as New Price Source"
									instead.
								</p>
							</div>
						)}
					</div>

					{/* What Will Happen */}
					{selectedTargetId && (
						<div className="space-y-2">
							<p className="text-sm font-medium text-foreground">
								What will happen:
							</p>
							<ul className="text-sm text-muted-foreground space-y-1">
								<li className="flex items-start gap-2">
									<ArrowRight className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
									<span>
										<strong>"{store.name}"</strong> will be merged into{" "}
										<strong>"{selectedStoreName}"</strong>
									</span>
								</li>
								<li className="flex items-start gap-2">
									<ArrowRight className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
									<span>
										Any physical stores linked to "{store.name}" will be
										re-linked to the target
									</span>
								</li>
								<li className="flex items-start gap-2">
									<ArrowRight className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
									<span>The pending store "{store.name}" will be removed</span>
								</li>
							</ul>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={handleConfirm}
						disabled={!selectedTargetId || isLoading}
						className="bg-blue-600 hover:bg-blue-700 text-white"
					>
						{isLoading ? "Merging..." : "Merge Stores"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
