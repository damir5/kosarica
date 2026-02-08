"use client";

import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/orpc/client";
import { useLocation } from "./use-location";

export function useNearbyStores() {
	const { location } = useLocation();

	const { data, isLoading } = useQuery({
		...orpc.stores.listNearby.queryOptions({
			input: {
				lat: location?.lat ?? 0,
				lng: location?.lng ?? 0,
				radiusKm: location?.radiusKm ?? 10,
			},
		}),
		enabled: !!location,
		staleTime: 5 * 60 * 1000,
	});

	const stores = data?.stores ?? [];

	// Collect both the physical store ID and its priceSourceStoreId for ClickHouse filtering
	const priceStoreIds = new Set<string>();
	for (const store of stores) {
		priceStoreIds.add(store.id);
		if (store.priceSourceStoreId) {
			priceStoreIds.add(store.priceSourceStoreId);
		}
	}

	// Derive unique chain slugs for search index filtering
	const chainSlugs = Array.from(new Set(stores.map((s) => s.chainSlug)));

	return {
		stores,
		priceStoreIds: Array.from(priceStoreIds),
		chainSlugs,
		isLoading,
		isActive: !!location,
	};
}
