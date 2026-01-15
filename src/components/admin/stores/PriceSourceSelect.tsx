import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { orpc } from "@/orpc/client";

interface PriceSourceSelectProps {
	chainSlug: string;
	value: string;
	onValueChange: (value: string) => void;
	disabled?: boolean;
}

export function PriceSourceSelect({
	chainSlug,
	value,
	onValueChange,
	disabled = false,
}: PriceSourceSelectProps) {
	const { data, isLoading } = useQuery(
		orpc.admin.stores.getVirtualStoresForLinking.queryOptions({
			input: { chainSlug },
		}),
	);

	const virtualStores = data?.stores || [];

	if (isLoading) {
		return (
			<Select disabled>
				<SelectTrigger>
					<SelectValue placeholder="Loading price sources..." />
				</SelectTrigger>
			</Select>
		);
	}

	if (virtualStores.length === 0) {
		return (
			<div className="rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
				No virtual price sources available for this chain
			</div>
		);
	}

	return (
		<Select value={value} onValueChange={onValueChange} disabled={disabled}>
			<SelectTrigger>
				<SelectValue placeholder="Select a price source...">
					{value && (
						<span className="flex items-center gap-2">
							<Link2 className="h-3 w-3" />
							{virtualStores.find((s) => s.id === value)?.name || value}
						</span>
					)}
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{virtualStores.map((store) => (
					<SelectItem key={store.id} value={store.id}>
						{store.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
