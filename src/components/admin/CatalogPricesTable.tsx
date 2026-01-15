import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

const currencyFormatter = new Intl.NumberFormat("hr-HR", {
	style: "currency",
	currency: "EUR",
});

export type CatalogPriceRow = {
	id: string;
	productName: string;
	brand: string | null;
	category: string | null;
	chainName: string;
	chainSlug: string;
	storeId: string;
	storeName: string;
	storeCity: string | null;
	currentPrice: number | null;
	discountPrice: number | null;
	lastSeenAt: Date | string | null;
};

interface CatalogPricesTableProps {
	prices: CatalogPriceRow[];
}

const formatPrice = (price: number | null) => {
	if (price === null || price === undefined) return "-";
	return currencyFormatter.format(price / 100);
};

const formatDate = (value: Date | string | null) => {
	if (!value) return "-";
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return "-";
	return date.toLocaleDateString();
};

export function CatalogPricesTable({ prices }: CatalogPricesTableProps) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Product</TableHead>
					<TableHead>Chain</TableHead>
					<TableHead>Store</TableHead>
					<TableHead>Price</TableHead>
					<TableHead>Discount</TableHead>
					<TableHead>Category</TableHead>
					<TableHead>Last Seen</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{prices.length === 0 ? (
					<TableRow>
						<TableCell colSpan={7} className="py-12 text-center">
							<span className="text-muted-foreground">
								No catalog prices found
							</span>
						</TableCell>
					</TableRow>
				) : (
					prices.map((price) => (
						<TableRow key={price.id}>
							<TableCell>
								<div className="font-medium text-foreground">
									{price.productName}
								</div>
								{price.brand && (
									<div className="text-muted-foreground text-xs">
										{price.brand}
									</div>
								)}
							</TableCell>
							<TableCell>
								<Badge variant="secondary">{price.chainName}</Badge>
							</TableCell>
							<TableCell>
								<div className="font-medium text-foreground">
									{price.storeName}
								</div>
								{price.storeCity && (
									<div className="text-muted-foreground text-xs">
										{price.storeCity}
									</div>
								)}
							</TableCell>
							<TableCell className="font-mono">
								{formatPrice(price.currentPrice)}
							</TableCell>
							<TableCell>
								{price.discountPrice !== null && price.discountPrice !== undefined ? (
									<Badge variant="destructive" className="font-mono">
										{formatPrice(price.discountPrice)}
									</Badge>
								) : (
									<span className="text-muted-foreground">-</span>
								)}
							</TableCell>
							<TableCell>
								{price.category ? (
									<span>{price.category}</span>
								) : (
									<span className="text-muted-foreground">-</span>
								)}
							</TableCell>
							<TableCell>{formatDate(price.lastSeenAt)}</TableCell>
						</TableRow>
					))
				)}
			</TableBody>
		</Table>
	);
}
