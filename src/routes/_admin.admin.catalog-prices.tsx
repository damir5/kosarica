import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, DollarSign, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	type CatalogPriceRow,
	CatalogPricesTable,
} from "@/components/admin/CatalogPricesTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/catalog-prices")({
	component: CatalogPricesPage,
});

const CHAINS = [
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
	{ slug: "trgocentar", name: "Trgocentar" },
];

const priceInputToCents = (value: string) => {
	if (!value) return undefined;
	const parsed = Number.parseFloat(value);
	if (Number.isNaN(parsed)) return undefined;
	return Math.round(parsed * 100);
};

const dateInputToIso = (value: string, boundary: "start" | "end") => {
	if (!value) return undefined;
	const time = boundary === "start" ? "00:00:00" : "23:59:59";
	const date = new Date(`${value}T${time}`);
	if (Number.isNaN(date.getTime())) return undefined;
	return date.toISOString();
};

function CatalogPricesPage() {
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [chainFilter, setChainFilter] = useState("all");
	const [storeFilter, setStoreFilter] = useState("all");
	const [categoryFilter, setCategoryFilter] = useState("all");
	const [minPrice, setMinPrice] = useState("");
	const [maxPrice, setMaxPrice] = useState("");
	const [dateFrom, setDateFrom] = useState("");
	const [dateTo, setDateTo] = useState("");
	const [page, setPage] = useState(1);

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(search);
			setPage(1);
		}, 300);
		return () => clearTimeout(timer);
	}, [search]);

	const minPriceCents = useMemo(() => priceInputToCents(minPrice), [minPrice]);
	const maxPriceCents = useMemo(() => priceInputToCents(maxPrice), [maxPrice]);
	const dateFromIso = useMemo(
		() => dateInputToIso(dateFrom, "start"),
		[dateFrom],
	);
	const dateToIso = useMemo(() => dateInputToIso(dateTo, "end"), [dateTo]);

	const { data, isLoading, error } = useQuery(
		orpc.admin.catalogPrices.list.queryOptions({
			input: {
				page,
				pageSize: 20,
				chainSlug: chainFilter !== "all" ? chainFilter : undefined,
				storeId: storeFilter !== "all" ? storeFilter : undefined,
				category: categoryFilter !== "all" ? categoryFilter : undefined,
				search: debouncedSearch || undefined,
				minPrice: minPriceCents,
				maxPrice: maxPriceCents,
				dateFrom: dateFromIso,
				dateTo: dateToIso,
			},
		}),
	);

	const { data: storesData, isLoading: storesLoading } = useQuery({
		...orpc.admin.catalogPrices.getStoresByChain.queryOptions({
			input: { chainSlug: chainFilter },
		}),
		enabled: chainFilter !== "all",
	});

	const { data: categoriesData } = useQuery(
		orpc.admin.catalogPrices.getCategories.queryOptions({
			input: {
				chainSlug: chainFilter !== "all" ? chainFilter : undefined,
			},
		}),
	);

	const filtersActive =
		search.trim() !== "" ||
		chainFilter !== "all" ||
		storeFilter !== "all" ||
		categoryFilter !== "all" ||
		minPrice !== "" ||
		maxPrice !== "" ||
		dateFrom !== "" ||
		dateTo !== "";

	const clearFilters = () => {
		setSearch("");
		setDebouncedSearch("");
		setChainFilter("all");
		setStoreFilter("all");
		setCategoryFilter("all");
		setMinPrice("");
		setMaxPrice("");
		setDateFrom("");
		setDateTo("");
		setPage(1);
	};

	const storeOptions = storesData?.stores ?? [];
	const categoryOptions = categoriesData?.categories ?? [];

	return (
		<>
			{/* Header */}
			<div className="border-border border-b bg-card">
				<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
					<div className="flex items-center gap-3">
						<DollarSign className="h-8 w-8 text-primary" />
						<div>
							<h1 className="font-semibold text-2xl text-foreground">
								Catalog Prices
							</h1>
							<p className="mt-1 text-muted-foreground text-sm">
								Browse and filter prices across chains, stores, and categories
							</p>
						</div>
					</div>
				</div>
			</div>

			{/* Main Content */}
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
				{/* Filters */}
				<div className="mb-6 space-y-4">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-center">
						<div className="relative flex-1">
							<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Search by product name or brand..."
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								className="pl-9"
							/>
						</div>
						<div className="flex flex-wrap gap-2">
							<Select
								value={chainFilter}
								onValueChange={(value) => {
									setChainFilter(value);
									setStoreFilter("all");
									setPage(1);
								}}
							>
								<SelectTrigger className="w-[140px]">
									<SelectValue placeholder="Chain" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Chains</SelectItem>
									{CHAINS.map((chain) => (
										<SelectItem key={chain.slug} value={chain.slug}>
											{chain.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Select
								value={storeFilter}
								onValueChange={(value) => {
									setStoreFilter(value);
									setPage(1);
								}}
								disabled={chainFilter === "all"}
							>
								<SelectTrigger className="w-[180px]">
									<SelectValue
										placeholder={
											chainFilter === "all" ? "Select chain first" : "Store"
										}
									/>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Stores</SelectItem>
									{storesLoading && (
										<SelectItem value="loading" disabled>
											Loading stores...
										</SelectItem>
									)}
									{!storesLoading && storeOptions.length === 0 && (
										<SelectItem value="none" disabled>
											No stores found
										</SelectItem>
									)}
									{storeOptions.map((store) => (
										<SelectItem key={store.id} value={store.id}>
											{store.name}
											{store.city ? ` (${store.city})` : ""}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Select
								value={categoryFilter}
								onValueChange={(value) => {
									setCategoryFilter(value);
									setPage(1);
								}}
							>
								<SelectTrigger className="w-[180px]">
									<SelectValue placeholder="Category" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Categories</SelectItem>
									{categoryOptions.length === 0 && (
										<SelectItem value="none" disabled>
											No categories found
										</SelectItem>
									)}
									{categoryOptions.map((category) => (
										<SelectItem key={category} value={category}>
											{category}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
						<div className="flex flex-wrap items-center gap-4">
							<div className="flex items-center gap-2">
								<span className="text-sm text-muted-foreground">Min</span>
								<Input
									type="number"
									min={0}
									step="0.01"
									placeholder="0.00"
									value={minPrice}
									onChange={(event) => {
										setMinPrice(event.target.value);
										setPage(1);
									}}
									className="w-28"
								/>
								<span className="text-sm text-muted-foreground">Max</span>
								<Input
									type="number"
									min={0}
									step="0.01"
									placeholder="0.00"
									value={maxPrice}
									onChange={(event) => {
										setMaxPrice(event.target.value);
										setPage(1);
									}}
									className="w-28"
								/>
							</div>
							<div className="flex items-center gap-2">
								<span className="text-sm text-muted-foreground">From</span>
								<Input
									type="date"
									value={dateFrom}
									onChange={(event) => {
										setDateFrom(event.target.value);
										setPage(1);
									}}
									className="w-[150px]"
								/>
								<span className="text-sm text-muted-foreground">To</span>
								<Input
									type="date"
									value={dateTo}
									onChange={(event) => {
										setDateTo(event.target.value);
										setPage(1);
									}}
									className="w-[150px]"
								/>
							</div>
						</div>
						{filtersActive && (
							<Button variant="ghost" size="sm" onClick={clearFilters}>
								<X className="mr-2 h-4 w-4" />
								Clear
							</Button>
						)}
					</div>
				</div>

				{/* Error State */}
				{error && (
					<div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
						<p className="text-sm text-destructive">Error: {error.message}</p>
					</div>
				)}

				{/* Loading State */}
				{isLoading && (
					<div className="flex items-center justify-center py-12">
						<p className="text-muted-foreground">Loading prices...</p>
					</div>
				)}

				{/* Table */}
				{data && !isLoading && (
					<>
						<CatalogPricesTable prices={data.prices as CatalogPriceRow[]} />

						{/* Pagination */}
						<div className="mt-4 flex items-center justify-between">
							<p className="text-sm text-muted-foreground">
								Showing {(page - 1) * 20 + 1} to{" "}
								{Math.min(page * 20, data.total)} of {data.total} prices
							</p>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => setPage((current) => Math.max(1, current - 1))}
									disabled={page === 1}
								>
									<ChevronLeft className="h-4 w-4" />
									Previous
								</Button>
								<span className="text-sm">
									Page {page} of {data.totalPages || 1}
								</span>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setPage((current) => current + 1)}
									disabled={page >= (data.totalPages || 1)}
								>
									Next
									<ChevronRight className="h-4 w-4" />
								</Button>
							</div>
						</div>
					</>
				)}
			</div>
		</>
	);
}
