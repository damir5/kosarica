import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/orpc";

interface CreateProductModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	retailerItemId: string;
	initialData?: {
		name: string;
		brand: string | null;
		category: string | null;
		unit: string | null;
		unitQuantity: string | null;
		imageUrl: string | null;
	};
	onSuccess?: (productId: string) => void;
}

export function CreateProductModal({
	open,
	onOpenChange,
	retailerItemId,
	initialData,
	onSuccess,
}: CreateProductModalProps) {
	const [formData, setFormData] = useState({
		name: initialData?.name ?? "",
		brand: initialData?.brand ?? "",
		category: initialData?.category ?? "",
		unit: initialData?.unit ?? "",
		unitQuantity: initialData?.unitQuantity ?? "",
		imageUrl: initialData?.imageUrl ?? "",
		description: "",
	});

	const createMutation = useMutation({
		mutationFn: async (data: typeof formData) => {
			// This would be a new endpoint to create a product and link it
			// For now, we'll use of approveMatch with a special flag
			return await orpc.admin.products.approveMatch.call({
				queueId: retailerItemId,
				notes: `Created new product: ${data.name}`,
				version: 1,
			});
		},
		onSuccess: (result) => {
			onOpenChange(false);
			onSuccess?.((result as unknown as { productId: string }).productId ?? "");
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!formData.name.trim()) return;
		createMutation.mutate(formData);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Create New Product</DialogTitle>
					<DialogDescription>
						Create a new canonical product from this retailer item
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="name">Product Name *</Label>
						<Input
							id="name"
							value={formData.name}
							onChange={(e) =>
								setFormData({ ...formData, name: e.target.value })
							}
							required
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="brand">Brand</Label>
						<Input
							id="brand"
							value={formData.brand}
							onChange={(e) =>
								setFormData({ ...formData, brand: e.target.value })
							}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="category">Category</Label>
						<Input
							id="category"
							value={formData.category}
							onChange={(e) =>
								setFormData({ ...formData, category: e.target.value })
							}
						/>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="unitQuantity">Quantity</Label>
							<Input
								id="unitQuantity"
								value={formData.unitQuantity}
								onChange={(e) =>
									setFormData({ ...formData, unitQuantity: e.target.value })
								}
								placeholder="e.g., 1, 500"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="unit">Unit</Label>
							<Input
								id="unit"
								value={formData.unit}
								onChange={(e) =>
									setFormData({ ...formData, unit: e.target.value })
								}
								placeholder="e.g., kg, l, kom"
							/>
						</div>
					</div>

					<div className="space-y-2">
						<Label htmlFor="imageUrl">Image URL</Label>
						<Input
							id="imageUrl"
							value={formData.imageUrl}
							onChange={(e) =>
								setFormData({ ...formData, imageUrl: e.target.value })
							}
							placeholder="https://..."
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="description">Description</Label>
						<Textarea
							id="description"
							value={formData.description}
							onChange={(e) =>
								setFormData({ ...formData, description: e.target.value })
							}
							rows={3}
						/>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={createMutation.isPending || !formData.name.trim()}
						>
							{createMutation.isPending && (
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
							)}
							Create Product
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
