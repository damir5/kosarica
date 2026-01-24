import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { orpc } from "@/orpc";

interface Product {
	id: string;
	name: string;
	brand: string | null;
	category: string | null;
	imageUrl: string | null;
}

interface ProductSearchProps {
	query: string;
	onSelect: (product: Product) => void;
	minLength?: number;
	limit?: number;
}

export function ProductSearch({
	query: initialQuery,
	onSelect,
	minLength = 3,
	limit = 20,
}: ProductSearchProps) {
	const [query, setQuery] = useState(initialQuery);

	const { data: results, isLoading } = useQuery({
		queryKey: ["admin", "products", "search", query],
		queryFn: () => orpc.admin.products.searchProducts({ query, limit }),
		enabled: query.length >= minLength,
	});

	const products = (results as unknown as Product[]) ?? [];

	return (
		<div className="space-y-4">
			<div className="relative">
				<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
				<Input
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search products by name..."
					className="pl-10"
				/>
				{isLoading && (
					<Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
				)}
			</div>

			{query.length > 0 && query.length < minLength && (
				<p className="text-sm text-muted-foreground">
					Enter at least {minLength} characters to search
				</p>
			)}

			{products.length > 0 && (
				<div className="space-y-2 max-h-96 overflow-y-auto">
					{products.map((product) => (
						<button
							type="button"
							key={product.id}
							onClick={() => onSelect(product)}
							className="w-full text-left p-3 border rounded-lg hover:border-primary hover:bg-primary/5 transition-colors"
						>
							<div className="flex items-start gap-3">
								{product.imageUrl ? (
									<img
										src={product.imageUrl}
										alt={product.name}
										className="w-12 h-12 object-cover rounded"
									/>
								) : (
									<div className="w-12 h-12 bg-muted rounded flex items-center justify-center text-muted-foreground text-xs">
										No image
									</div>
								)}
								<div className="flex-1 min-w-0">
									<div className="font-medium truncate">{product.name}</div>
									<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
										{product.brand && <span>{product.brand}</span>}
										{product.category && (
											<Badge variant="outline">{product.category}</Badge>
										)}
									</div>
								</div>
							</div>
						</button>
					))}
				</div>
			)}

			{query.length >= minLength && !isLoading && products.length === 0 && (
				<p className="text-center text-muted-foreground py-4">
					No products found
				</p>
			)}
		</div>
	);
}
