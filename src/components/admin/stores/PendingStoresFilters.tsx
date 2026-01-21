import {
	ArrowUpDown,
	Building2,
	Filter,
	Search,
	X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

// Chain options
const CHAINS = [
	{ slug: "all", name: "All Chains" },
	{ slug: "konzum", name: "Konzum" },
	{ slug: "lidl", name: "Lidl" },
	{ slug: "plodine", name: "Plodine" },
	{ slug: "interspar", name: "Interspar" },
	{ slug: "kaufland", name: "Kaufland" },
	{ slug: "ktc", name: "KTC" },
	{ slug: "eurospin", name: "Eurospin" },
	{ slug: "dm", name: "DM" },
	{ slug: "metro", name: "Metro" },
	{ slug: "studenac", name: "Studenac" },
];

export type PendingStoreSortOption =
	| "newest"
	| "oldest"
	| "name_asc"
	| "name_desc"
	| "chain_asc";

interface PendingStoresFiltersProps {
	searchQuery: string;
	onSearchChange: (value: string) => void;
	selectedChain: string;
	onChainChange: (value: string) => void;
	sortBy: PendingStoreSortOption;
	onSortChange: (value: PendingStoreSortOption) => void;
	storeCount: number;
	hasActiveFilters: boolean;
	onClearFilters: () => void;
}

const SORT_OPTIONS = [
	{ value: "newest", label: "Newest First" },
	{ value: "oldest", label: "Oldest First" },
	{ value: "name_asc", label: "Name (A-Z)" },
	{ value: "name_desc", label: "Name (Z-A)" },
	{ value: "chain_asc", label: "Chain (A-Z)" },
] as const;

export function PendingStoresFilters({
	searchQuery,
	onSearchChange,
	selectedChain,
	onChainChange,
	sortBy,
	onSortChange,
	storeCount,
	hasActiveFilters,
	onClearFilters,
}: PendingStoresFiltersProps) {
	return (
		<div className="flex flex-col gap-4">
			{/* Header with count */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Filter className="h-4 w-4 text-muted-foreground" />
					<h3 className="font-medium text-sm">Filters</h3>
				</div>
				{hasActiveFilters && (
					<Button
						variant="ghost"
						size="sm"
						onClick={onClearFilters}
						className="h-7 text-xs"
					>
						<X className="h-3 w-3 mr-1" />
						Clear
					</Button>
				)}
			</div>

			{/* Search */}
			<div className="relative">
				<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
				<Input
					type="text"
					placeholder="Search by name, address, city..."
					value={searchQuery}
					onChange={(e) => onSearchChange(e.target.value)}
					className="pl-9"
				/>
			</div>

			{/* Chain Filter */}
			<div className="space-y-2">
				<label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
					<Building2 className="h-3 w-3" />
					Chain
				</label>
				<Select value={selectedChain} onValueChange={onChainChange}>
					<SelectTrigger className="w-full">
						<SelectValue placeholder="Select chain" />
					</SelectTrigger>
					<SelectContent>
						{CHAINS.map((chain) => (
							<SelectItem key={chain.slug} value={chain.slug}>
								{chain.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* Sort */}
			<div className="space-y-2">
				<label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
					<ArrowUpDown className="h-3 w-3" />
					Sort By
				</label>
				<Select value={sortBy} onValueChange={(v) => onSortChange(v as PendingStoreSortOption)}>
					<SelectTrigger className="w-full">
						<SelectValue placeholder="Sort by" />
					</SelectTrigger>
					<SelectContent>
						{SORT_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* Results count */}
			<div className="pt-2 border-t">
				<p className="text-xs text-muted-foreground">
					<span className="font-medium text-foreground">{storeCount}</span> store
					{storeCount !== 1 ? "s" : ""} found
				</p>
			</div>
		</div>
	);
}
