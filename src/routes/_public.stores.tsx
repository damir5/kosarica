"use client";

import { createFileRoute } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { EmptyState, type StoreSlug, StoreChip } from "@/components/public/domain";
import { PageContainer, Section } from "@/components/public/layout";
import { Heading, Text, TkSkeleton } from "@/components/public/primitives";
import { useLocation } from "@/hooks/use-location";
import { useNearbyStores } from "@/hooks/use-nearby-stores";
import { LocationPickerDrawer } from "@/components/public/domain/location-picker-drawer";

const StoreMap = lazy(() => import("@/components/public/domain/store-map"));

export const Route = createFileRoute("/_public/stores")({
	head: () => ({
		meta: [{ title: "Trgovine | Tvoja Košarica" }],
	}),
	component: StoresPage,
});

function StoresPage() {
	const { location, isSet } = useLocation();
	const { stores, isLoading } = useNearbyStores();
	const [pickerOpen, setPickerOpen] = useState(false);

	if (!isSet) {
		return (
			<PageContainer>
				<EmptyState
					variant="location-required"
					icon={<MapPin className="size-16 text-tk-text-tertiary opacity-40" />}
					action={{
						label: "Odaberi lokaciju",
						onClick: () => setPickerOpen(true),
					}}
				/>
				<LocationPickerDrawer open={pickerOpen} onOpenChange={setPickerOpen} />
			</PageContainer>
		);
	}

	// Group stores by chain
	const byChain = new Map<string, typeof stores>();
	for (const store of stores) {
		const existing = byChain.get(store.chainSlug) ?? [];
		existing.push(store);
		byChain.set(store.chainSlug, existing);
	}

	return (
		<PageContainer>
			<Heading level={1} size="xl">
				Trgovine u blizini
			</Heading>
			<Text variant="small" className="text-tk-text-secondary mb-4">
				{stores.length} trgovina u krugu od {location?.radiusKm ?? 10} km
				{location?.city ? ` \u2014 ${location.city}` : ""}
			</Text>

			{isLoading ? (
				<TkSkeleton className="h-[300px] w-full rounded-lg" />
				) : (
					<Section>
						<Suspense fallback={<TkSkeleton className="h-[300px] w-full rounded-lg" />}>
							{location ? (
								<StoreMap
									center={[location.lat, location.lng]}
									stores={stores}
									className="h-[300px] rounded-lg"
								/>
							) : (
								<TkSkeleton className="h-[300px] w-full rounded-lg" />
							)}
						</Suspense>
					</Section>
				)}

			{!isLoading && stores.length > 0 && (
				<Section title="Po lancima">
					<div className="space-y-4">
						{Array.from(byChain.entries()).map(([chainSlug, chainStores]) => (
							<div key={chainSlug}>
								<div className="flex items-center gap-2 mb-2">
									<StoreChip store={chainSlug as StoreSlug} variant="compact" />
									<Text variant="small" className="text-tk-text-secondary">
										{chainStores.length} trgovina
									</Text>
								</div>
								<div className="space-y-1">
									{chainStores.map((store) => (
										<div
											key={store.id}
											className="flex items-center justify-between rounded-lg px-3 py-2 bg-tk-surface-alt"
										>
											<div className="min-w-0 flex-1">
												<Text variant="small" className="font-medium truncate">
													{store.displayName ?? store.name}
												</Text>
												{store.address && (
													<Text variant="caption" className="text-tk-text-tertiary truncate">
														{store.address}
													</Text>
												)}
											</div>
											<Text variant="caption" className="shrink-0 ml-3 text-tk-text-tertiary">
												{store.distanceKm} km
											</Text>
										</div>
									))}
								</div>
							</div>
						))}
					</div>
				</Section>
			)}

			{!isLoading && stores.length === 0 && (
				<EmptyState
					variant="generic"
					title="Nema trgovina u blizini"
					description="Pokušaj povećati radijus ili odaberi drugi grad."
				/>
			)}
		</PageContainer>
	);
}
