import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

interface BulkActionsBarProps {
	selectedCount: number;
	onApprove: () => void;
	onClear: () => void;
	isLoading: boolean;
}

export function BulkActionsBar({ selectedCount, onApprove, onClear, isLoading }: BulkActionsBarProps) {
	return (
		<div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 z-50 md:relative md:bg-muted/50 md:rounded-lg md:p-3">
			<div className="flex items-center justify-between max-w-screen-2xl mx-auto">
				<span className="text-sm font-medium">
					{selectedCount} item{selectedCount !== 1 ? "s" : ""} selected
				</span>
				<div className="flex gap-2">
					<Button onClick={onClear} variant="outline" size="sm">
						<X className="h-4 w-4 mr-2" />
						Clear
					</Button>
					<Button onClick={onApprove} disabled={isLoading} size="sm">
						<Check className="h-4 w-4 mr-2" />
						Approve All
					</Button>
				</div>
			</div>
		</div>
	);
}
