import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Building2, MapPin, Store as StoreIcon } from "lucide-react";
import { StoreEnrichmentSection } from "@/components/admin/stores/StoreEnrichmentSection";
import { StoreLocationMap } from "@/components/admin/stores/StoreLocationMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/stores/$storeId")({
	component: StoreDetailPage,
});

type StoreData = {
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

function StoreDetailPage() {
	const { storeId } = Route.useParams();
	const queryClient = useQueryClient();

	const { data, isLoading, error } = useQuery(
		orpc.admin.stores.get.queryOptions({
			input: { storeId },
		}),
	);

	const store = data as StoreData | undefined;

	// State for pending coordinate changes
	const [pendingCoordinates, setPendingCoordinates] = useState<{
		lat: string | null;
		lng: string | null;
	} | null>(null);

	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

	// Mutation for updating coordinates
	const updateCoordinatesMutation = useMutation({
		mutationFn: async (coords: { lat: string; lng: string }) => {
			return orpc.admin.stores.update.call({
				storeId: store!.id,
				lat: coords.lat,
				lng: coords.lng,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "stores", "get"] });
			setPendingCoordinates(null);
			setHasUnsavedChanges(false);
			toast.success("Coordinates updated successfully");
		},
		onError: (error) => {
			toast.error(`Failed to update coordinates: ${error.message}`);
		},
	});

	if (isLoading) {
		return (
			<div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
				<div className="flex items-center justify-center py-12">
					<p className="text-muted-foreground">Loading store details...</p>
				</div>
			</div>
		);
	}

	if (error || !store) {
		return (
			<div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
					<p className="text-sm text-destructive">
						Error: {error?.message || "Store not found"}
					</p>
				</div>
				<Button variant="outline" className="mt-4" asChild>
					<Link to="/admin/stores">
						<ArrowLeft className="mr-2 h-4 w-4" />
						Back to Stores
					</Link>
				</Button>
			</div>
		);
	}

	return (
		<>
			{/* Header */}
			<div className="border-border border-b bg-card">
				<div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
					<div className="flex items-center gap-4">
						<Button variant="ghost" size="icon" asChild>
							<Link to="/admin/stores">
								<ArrowLeft className="h-5 w-5" />
							</Link>
						</Button>
						<div className="flex-1">
							<div className="flex items-center gap-3">
								<StoreIcon className="h-8 w-8 text-primary" />
								<div>
									<h1 className="font-semibold text-2xl text-foreground">
										{store.name}
									</h1>
									<p className="mt-1 text-muted-foreground text-sm font-mono">
										{store.id}
									</p>
								</div>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Badge variant="outline">{store.chainSlug}</Badge>
							<Badge
								variant={store.status === "active" ? "default" : "secondary"}
							>
								{store.status}
							</Badge>
							{store.isVirtual && (
								<Badge variant="secondary">
									<Building2 className="mr-1 h-3 w-3" />
									Virtual
								</Badge>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* Main Content */}
			<div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
				{/* Location Card */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<MapPin className="h-5 w-5" />
							Location Information
						</CardTitle>
						<CardDescription>
							Store address and geographic coordinates
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{/* Address Information Grid */}
						<div className="grid gap-4 sm:grid-cols-2">
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Address
								</div>
								<p className="mt-1">{store.address || "Not set"}</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									City
								</div>
								<p className="mt-1">{store.city || "Not set"}</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Postal Code
								</div>
								<p className="mt-1">{store.postalCode || "Not set"}</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">
									Coordinates
								</div>
								<p className="mt-1 font-mono text-sm">
									{store.latitude && store.longitude ? (
										<>
											{Number(store.latitude).toFixed(6)},{" "}
											{Number(store.longitude).toFixed(6)}
										</>
									) : (
										<span className="text-muted-foreground">Not geocoded</span>
									)}
								</p>
							</div>
						</div>

						{/* Interactive Map */}
						<div className="mt-4 space-y-3">
							<div className="flex items-center justify-between">
								<h4 className="text-sm font-medium">
									{store.latitude && store.longitude
										? "Store Location"
										: "Set Store Location"}
								</h4>
								{hasUnsavedChanges && (
									<Badge variant="secondary" className="text-xs">
										Unsaved changes
									</Badge>
								)}
							</div>

							<StoreLocationMap
								latitude={
									pendingCoordinates?.lat ??
									store.latitude
								}
								longitude={
									pendingCoordinates?.lng ??
									store.longitude
								}
								onCoordinateChange={(lat, lng) => {
									setPendingCoordinates({ lat, lng });
									setHasUnsavedChanges(true);
								}}
								className="h-[400px] w-full"
							/>

							{/* Action Buttons */}
							{hasUnsavedChanges && (
								<div className="flex items-center gap-2">
									<Button
										onClick={() => {
											if (
												pendingCoordinates?.lat &&
												pendingCoordinates?.lng
											) {
												updateCoordinatesMutation.mutate({
													lat: pendingCoordinates.lat,
													lng: pendingCoordinates.lng,
												});
											}
										}}
										disabled={
											updateCoordinatesMutation.isPending
										}
										size="sm"
									>
										{updateCoordinatesMutation
											.isPending && (
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										)}
										Save Coordinates
									</Button>
									<Button
										variant="outline"
										size="sm"
										onClick={() => {
											setPendingCoordinates(null);
											setHasUnsavedChanges(false);
										}}
										disabled={
											updateCoordinatesMutation.isPending
										}
									>
										Cancel
									</Button>
								</div>
							)}
						</div>

						{/* External Map Link */}
						<div className="flex items-center justify-between border-t pt-4">
							<a
								href={`https://www.openstreetmap.org/?mlat=${pendingCoordinates?.lat ?? store.latitude ?? 45.8150}&mlon=${pendingCoordinates?.lng ?? store.longitude ?? 15.9819}&zoom=17`}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
							>
								View on OpenStreetMap
								<MapPin className="h-3 w-3" />
							</a>
						</div>
					</CardContent>
				</Card>

				{/* Enrichment Section */}
				<StoreEnrichmentSection storeId={store.id} store={store} />
			</div>
		</>
	);
}
