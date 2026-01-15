import { type RankingInfo, rankItem } from "@tanstack/match-sorter-utils";
import {
	type ColumnDef,
	type ColumnFiltersState,
	type ColumnOrderState,
	type ColumnSizingState,
	type FilterFn,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
	type VisibilityState,
} from "@tanstack/react-table";
import {
	Check,
	ChevronDown,
	ChevronsUpDown,
	ChevronUp,
	Columns3,
	GripVertical,
	RotateCcw,
} from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { DebouncedInput } from "@/components/ui/debounced-input";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Module augmentation for custom filter
declare module "@tanstack/react-table" {
	interface FilterFns {
		fuzzy: FilterFn<unknown>;
	}
	interface FilterMeta {
		itemRank: RankingInfo;
	}
}

// Define fuzzy filter function using match-sorter
const fuzzyFilter: FilterFn<unknown> = (row, columnId, value, addMeta) => {
	const itemRank = rankItem(row.getValue(columnId), value);
	addMeta({ itemRank });
	return itemRank.passed;
};

interface DataTableProps<TData> {
	columns: ColumnDef<TData>[];
	data: TData[];
	// Optional features
	enableGlobalFilter?: boolean;
	enableColumnFilters?: boolean;
	enableSorting?: boolean;
	enablePagination?: boolean;
	enableColumnVisibility?: boolean;
	enableColumnResizing?: boolean;
	enableColumnOrdering?: boolean;
	// Customization
	pageSize?: number;
	pageSizeOptions?: number[];
	searchPlaceholder?: string;
	emptyMessage?: string;
	// Persistence
	storageKey?: string; // Unique key for localStorage persistence
}

export function DataTable<TData>({
	columns,
	data,
	enableGlobalFilter = true,
	enableColumnFilters = true,
	enableSorting = true,
	enablePagination = true,
	enableColumnVisibility = true,
	enableColumnResizing = true,
	enableColumnOrdering = true,
	pageSize = 20,
	pageSizeOptions = [10, 20, 50, 100],
	searchPlaceholder = "Search...",
	emptyMessage = "No results.",
	storageKey,
}: DataTableProps<TData>) {
	// Helper to load state from localStorage
	const loadState = <T,>(key: string, defaultValue: T): T => {
		if (!storageKey || typeof window === "undefined") return defaultValue;
		try {
			const saved = localStorage.getItem(`${storageKey}-${key}`);
			return saved ? JSON.parse(saved) : defaultValue;
		} catch {
			return defaultValue;
		}
	};

	// Helper to save state to localStorage
	const saveState = React.useCallback(
		<T,>(key: string, value: T) => {
			if (!storageKey || typeof window === "undefined") return;
			try {
				localStorage.setItem(`${storageKey}-${key}`, JSON.stringify(value));
			} catch {
				// Silently fail if localStorage is unavailable
			}
		},
		[storageKey],
	);

	const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
		[],
	);
	const [globalFilter, setGlobalFilter] = React.useState("");
	const [columnVisibility, setColumnVisibility] =
		React.useState<VisibilityState>(() => loadState("visibility", {}));
	const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>(
		() => loadState("sizing", {}),
	);
	const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>(() =>
		loadState("order", []),
	);

	// Drag and drop state for visual feedback
	const [draggedColumnId, setDraggedColumnId] = React.useState<string | null>(
		null,
	);
	const [dragOverColumnId, setDragOverColumnId] = React.useState<string | null>(
		null,
	);

	// Save state changes to localStorage
	React.useEffect(() => {
		saveState("visibility", columnVisibility);
	}, [columnVisibility, saveState]);

	React.useEffect(() => {
		saveState("sizing", columnSizing);
	}, [columnSizing, saveState]);

	React.useEffect(() => {
		saveState("order", columnOrder);
	}, [columnOrder, saveState]);

	const table = useReactTable({
		data,
		columns,
		filterFns: {
			fuzzy: fuzzyFilter,
		},
		state: {
			columnFilters,
			globalFilter,
			columnVisibility,
			columnSizing,
			columnOrder,
		},
		onColumnFiltersChange: setColumnFilters,
		onGlobalFilterChange: setGlobalFilter,
		onColumnVisibilityChange: setColumnVisibility,
		onColumnSizingChange: setColumnSizing,
		onColumnOrderChange: setColumnOrder,
		globalFilterFn: "fuzzy",
		enableColumnResizing: enableColumnResizing,
		columnResizeMode: "onChange",
		getCoreRowModel: getCoreRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		autoResetPageIndex: false,
		initialState: {
			pagination: {
				pageSize,
			},
		},
	});

	// Reset to defaults
	const handleReset = () => {
		if (storageKey) {
			localStorage.removeItem(`${storageKey}-visibility`);
			localStorage.removeItem(`${storageKey}-sizing`);
			localStorage.removeItem(`${storageKey}-order`);
		}
		setColumnVisibility({});
		setColumnSizing({});
		setColumnOrder([]);
	};

	return (
		<div className="space-y-4">
			{/* Controls Bar */}
			{(enableGlobalFilter || enableColumnVisibility) && (
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					{/* Global Search */}
					{enableGlobalFilter && (
						<DebouncedInput
							type="text"
							value={globalFilter ?? ""}
							onChange={(value) => setGlobalFilter(String(value))}
							placeholder={searchPlaceholder}
							className={cn(
								"flex h-9 w-full max-w-sm rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground",
								"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
							)}
						/>
					)}

					{/* Column Controls */}
					{enableColumnVisibility && (
						<div className="flex gap-2">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="outline" size="sm">
										<Columns3 className="mr-2 size-4" />
										Columns
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="w-48">
									<DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
									<DropdownMenuSeparator />
									{table
										.getAllColumns()
										.filter((column) => column.getCanHide())
										.map((column) => {
											const isVisible = column.getIsVisible();
											return (
												<DropdownMenuItem
													key={column.id}
													onClick={(e) => {
														e.preventDefault();
														column.toggleVisibility(!isVisible);
													}}
												>
													<div className="flex w-full items-center gap-2">
														<div className="flex h-4 w-4 items-center justify-center rounded-sm border">
															{isVisible && <Check className="h-3 w-3" />}
														</div>
														<span>
															{typeof column.columnDef.header === "string"
																? column.columnDef.header
																: column.id}
														</span>
													</div>
												</DropdownMenuItem>
											);
										})}
								</DropdownMenuContent>
							</DropdownMenu>

							{storageKey && (
								<Button variant="outline" size="sm" onClick={handleReset}>
									<RotateCcw className="mr-2 size-4" />
									Reset
								</Button>
							)}
						</div>
					)}
				</div>
			)}

			{/* Table */}
			<div className="overflow-auto rounded-md border">
				<Table
					style={{
						width: enableColumnResizing ? table.getTotalSize() : undefined,
						tableLayout: enableColumnResizing ? "fixed" : undefined,
					}}
				>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => {
									const isDragging = draggedColumnId === header.column.id;
									const isDropTarget =
										dragOverColumnId === header.column.id &&
										draggedColumnId !== header.column.id;

									return (
										<TableHead
											key={header.id}
											colSpan={header.colSpan}
											className={cn(
												"transition-all duration-150",
												isDragging && "opacity-50",
												isDropTarget &&
													"border-l-4 border-primary bg-accent/10",
											)}
											style={{
												width: enableColumnResizing
													? header.getSize()
													: undefined,
												position: "relative",
											}}
											onDragOver={(e) => {
												if (!draggedColumnId || !enableColumnOrdering) return;
												e.preventDefault();
												e.dataTransfer.dropEffect = "move";
												setDragOverColumnId(header.column.id);
											}}
											onDragLeave={() => {
												setDragOverColumnId(null);
											}}
											onDrop={(e) => {
												if (!enableColumnOrdering) return;
												e.preventDefault();
												const draggedId = e.dataTransfer.getData("text/plain");
												const newColumnOrder = [
													...table.getState().columnOrder,
												];

												if (newColumnOrder.length === 0) {
													// Initialize with current order
													const currentOrder = table
														.getAllLeafColumns()
														.map((c) => c.id);
													const draggedIndex = currentOrder.indexOf(draggedId);
													const targetIndex = currentOrder.indexOf(
														header.column.id,
													);

													if (draggedIndex !== targetIndex) {
														currentOrder.splice(draggedIndex, 1);
														currentOrder.splice(targetIndex, 0, draggedId);
														table.setColumnOrder(currentOrder);
													}
												} else {
													const draggedIndex =
														newColumnOrder.indexOf(draggedId);
													const targetIndex = newColumnOrder.indexOf(
														header.column.id,
													);

													if (
														draggedIndex !== -1 &&
														targetIndex !== -1 &&
														draggedIndex !== targetIndex
													) {
														newColumnOrder.splice(draggedIndex, 1);
														newColumnOrder.splice(targetIndex, 0, draggedId);
														table.setColumnOrder(newColumnOrder);
													}
												}

												setDraggedColumnId(null);
												setDragOverColumnId(null);
											}}
										>
											{header.isPlaceholder ? null : (
												<div className="space-y-2">
													<div className="flex items-center gap-1">
														{/* Drag Handle for Column Reordering */}
														{enableColumnOrdering && (
															<span
																className="flex cursor-grab items-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
																draggable
																onDragStart={(e) => {
																	e.dataTransfer.effectAllowed = "move";
																	e.dataTransfer.setData(
																		"text/plain",
																		header.column.id,
																	);
																	setDraggedColumnId(header.column.id);
																}}
																onDragEnd={() => {
																	setDraggedColumnId(null);
																	setDragOverColumnId(null);
																}}
															>
																<GripVertical className="size-4" />
															</span>
														)}

														{/* Column Header with Sort */}
														{enableSorting && header.column.getCanSort() ? (
															<button
																type="button"
																className="flex flex-1 select-none items-center gap-2 text-left hover:text-primary"
																onClick={header.column.getToggleSortingHandler()}
															>
																{flexRender(
																	header.column.columnDef.header,
																	header.getContext(),
																)}
																<span className="text-muted-foreground">
																	{header.column.getIsSorted() === "asc" ? (
																		<ChevronUp className="size-4" />
																	) : header.column.getIsSorted() === "desc" ? (
																		<ChevronDown className="size-4" />
																	) : (
																		<ChevronsUpDown className="size-4" />
																	)}
																</span>
															</button>
														) : (
															<div className="flex flex-1 items-center gap-2">
																{flexRender(
																	header.column.columnDef.header,
																	header.getContext(),
																)}
															</div>
														)}
													</div>

													{/* Column Filter */}
													{enableColumnFilters &&
														header.column.getCanFilter() && (
															<DebouncedInput
																type="text"
																value={
																	(header.column.getFilterValue() as string) ??
																	""
																}
																onChange={(value) =>
																	header.column.setFilterValue(value)
																}
																placeholder="Filter..."
																className={cn(
																	"flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground",
																	"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
																)}
															/>
														)}
												</div>
											)}

											{/* Column Resize Handle */}
											{enableColumnResizing && header.column.getCanResize() && (
												<div
													onMouseDown={header.getResizeHandler()}
													onTouchStart={header.getResizeHandler()}
													className={cn(
														"absolute right-0 top-0 h-full w-0.5 cursor-col-resize touch-none select-none bg-border transition-all",
														"hover:w-1 hover:bg-primary",
														header.column.getIsResizing() && "w-1 bg-primary",
													)}
												/>
											)}
										</TableHead>
									);
								})}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows.length > 0 ? (
							table.getRowModel().rows.map((row) => (
								<TableRow key={row.id}>
									{row.getVisibleCells().map((cell) => (
										<TableCell
											key={cell.id}
											style={{
												width: enableColumnResizing
													? cell.column.getSize()
													: undefined,
											}}
										>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="h-24 text-center text-muted-foreground"
								>
									{emptyMessage}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>

			{/* Pagination */}
			{enablePagination && (
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="text-sm text-muted-foreground">
						{table.getFilteredRowModel().rows.length} row(s) total
					</div>

					<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
						{/* Page Navigation */}
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => table.setPageIndex(0)}
								disabled={!table.getCanPreviousPage()}
							>
								{"<<"}
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => table.previousPage()}
								disabled={!table.getCanPreviousPage()}
							>
								{"<"}
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => table.nextPage()}
								disabled={!table.getCanNextPage()}
							>
								{">"}
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => table.setPageIndex(table.getPageCount() - 1)}
								disabled={!table.getCanNextPage()}
							>
								{">>"}
							</Button>
						</div>

						{/* Page Info & Controls */}
						<div className="flex items-center gap-4">
							<span className="text-sm">
								Page {table.getState().pagination.pageIndex + 1} of{" "}
								{table.getPageCount()}
							</span>

							<div className="flex items-center gap-2">
								<span className="text-sm">Go to:</span>
								<Input
									type="number"
									min={1}
									max={table.getPageCount()}
									defaultValue={table.getState().pagination.pageIndex + 1}
									onChange={(e) => {
										const page = e.target.value
											? Number(e.target.value) - 1
											: 0;
										table.setPageIndex(page);
									}}
									className="h-8 w-16"
								/>
							</div>

							<select
								value={table.getState().pagination.pageSize}
								onChange={(e) => {
									table.setPageSize(Number(e.target.value));
								}}
								className={cn(
									"flex h-8 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
									"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
								)}
							>
								{pageSizeOptions.map((size) => (
									<option key={size} value={size}>
										Show {size}
									</option>
								))}
							</select>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
