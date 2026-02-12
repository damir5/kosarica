import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	Building2,
	MapPin,
	RotateCcw,
	Store as StoreIcon,
} from "lucide-react";
import { useState } from "react";
import { StoreEnrichmentSection } from "@/components/admin/stores/StoreEnrichmentSection";
import { StoreLocationMap } from "@/components/admin/stores/StoreLocationMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/stores/$storeId")({
	component: StoreDetailPage,
});

function StoreDetailPage() {
	const { storeId } = Route.useParams();
	const queryClient = useQueryClient();
	const [editingDisplayName, setEditingDisplayName] = useState(false);
	const [displayNameValue, setDisplayNameValue] = useState("");

	const {
		data: store,
		isLoading,
		error,
	} = useQuery(
		orpc.admin.stores.get.queryOptions({
			input: { storeId },
		}),
	);

	const updateMutation = useMutation({
		mutationFn: async (data: {
			storeId: string;
			displayName: string | null;
		}) => {
			return orpc.admin.stores.update.call(data);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.admin.stores.key({ type: "query" }),
			});
			setEditingDisplayName(false);
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
										{store.displayName ?? store.name}
									</h1>
									{store.displayName && store.displayName !== store.name && (
										<p className="mt-0.5 text-muted-foreground text-sm font-mono">
											{store.name}
										</p>
									)}
									<p className="mt-0.5 text-muted-foreground text-xs font-mono">
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
						{/* Display Name */}
						<div>
							<div className="flex items-center justify-between">
								<div className="text-sm font-medium text-muted-foreground">
									Display Name
									{store.displayNameManual && (
										<Badge variant="outline" className="ml-2 text-xs">
											manual
										</Badge>
									)}
								</div>
								<div className="flex items-center gap-1">
									{editingDisplayName ? (
										<>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setEditingDisplayName(false)}
											>
												Cancel
											</Button>
											<Button
												size="sm"
												onClick={() => {
													updateMutation.mutate({
														storeId: store.id,
														displayName: displayNameValue || null,
													});
												}}
												disabled={updateMutation.isPending}
											>
												Save
											</Button>
										</>
									) : (
										<>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => {
													setDisplayNameValue(store.displayName ?? "");
													setEditingDisplayName(true);
												}}
											>
												Edit
											</Button>
											{store.displayNameManual && (
												<Button
													variant="ghost"
													size="sm"
													title="Reset to automatic"
													onClick={() => {
														updateMutation.mutate({
															storeId: store.id,
															displayName: null,
														});
													}}
													disabled={updateMutation.isPending}
												>
													<RotateCcw className="h-3 w-3" />
												</Button>
											)}
										</>
									)}
								</div>
							</div>
							{editingDisplayName ? (
								<Input
									value={displayNameValue}
									onChange={(e) => setDisplayNameValue(e.target.value)}
									placeholder="Enter display name (leave empty for auto)"
									className="mt-1"
								/>
							) : (
								<p className="mt-1">
									{store.displayName ?? (
										<span className="text-muted-foreground">
											Not set (auto)
										</span>
									)}
								</p>
							)}
						</div>

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

						{/* Map */}
						{store.latitude && store.longitude && (
							<div className="border-t pt-4">
								<StoreLocationMap
									latitude={store.latitude}
									longitude={store.longitude}
									storeName={store.name}
								/>
							</div>
						)}

						{/* External Map Link */}
						{store.latitude && store.longitude && (
							<div className="border-t pt-4">
								<a
									href={`https://www.openstreetmap.org/?mlat=${store.latitude}&mlon=${store.longitude}&zoom=17`}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
								>
									View on OpenStreetMap
									<MapPin className="h-3 w-3" />
								</a>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Enrichment Section */}
				<StoreEnrichmentSection storeId={store.id} store={store} />
			</div>
		</>
	);
}
