"use client";

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useMemo } from "react";
import {
	STORE_COLORS,
	type StoreSlug,
} from "@/components/public/domain/store-colors";
import { orpc } from "@/orpc/client";
import { escapeHtml } from "@/utils/html";

const StoresMapClient = lazy(() => import("./StoresMapClient"));

interface StoresMapViewProps {
	chainFilter?: string;
	statusFilter?: string;
}

const validStatuses = new Set<string>(["active", "pending"]);

function toStatusFilter(
	value: string | undefined,
): "active" | "pending" | undefined {
	if (value && validStatuses.has(value)) return value as "active" | "pending";
	return undefined;
}

function MapSkeleton() {
	return (
		<div
			className="animate-pulse rounded-md bg-muted"
			style={{ minHeight: "500px" }}
		>
			<div className="flex h-full min-h-[500px] items-center justify-center text-muted-foreground text-sm">
				Loading map...
			</div>
		</div>
	);
}

export function StoresMapView({
	chainFilter,
	statusFilter,
}: StoresMapViewProps) {
	const { data, isLoading } = useQuery(
		orpc.admin.stores.listAllForMap.queryOptions({
			input: {
				chainSlug:
					chainFilter && chainFilter !== "all" ? chainFilter : undefined,
				status: toStatusFilter(statusFilter !== "all" ? statusFilter : undefined),
			},
		}),
	);

	const navigate = useNavigate();

	const markers = useMemo(() => {
		if (!data?.stores) return [];

		return data.stores
			.map((store) => {
				if (!store.latitude || !store.longitude) return null;
				const lat = Number.parseFloat(store.latitude);
				const lng = Number.parseFloat(store.longitude);
				if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

				const color = STORE_COLORS[store.chainSlug as StoreSlug] ?? "#6b7280";
				const displayName = store.displayName ?? store.name;

				const popup = `
					<div style="font-size:13px;line-height:1.4">
						<strong>${escapeHtml(displayName)}</strong>
						<div style="color:#666;font-size:12px">${escapeHtml(store.chainSlug)}${store.city ? ` &middot; ${escapeHtml(store.city)}` : ""}</div>
						${store.address ? `<div style="color:#888;font-size:12px">${escapeHtml(store.address)}</div>` : ""}
						<div style="margin-top:4px">
							<a href="/admin/stores/${escapeHtml(store.id)}" style="color:#2563eb;font-size:12px;text-decoration:underline">View details</a>
						</div>
					</div>
				`;

				return {
					id: store.id,
					lat,
					lng,
					popup,
					color,
					onClick: () => {
						navigate({
							to: "/admin/stores/$storeId",
							params: { storeId: store.id },
						});
					},
				};
			})
			.filter(Boolean) as Array<{
			id: string;
			lat: number;
			lng: number;
			popup: string;
			color: string;
			onClick: () => void;
		}>;
	}, [data, navigate]);

	if (isLoading) {
		return <MapSkeleton />;
	}

	const storesWithCoords =
		data?.stores?.filter((s) => s.latitude && s.longitude).length ?? 0;
	const totalStores = data?.stores?.length ?? 0;

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-4 text-sm text-muted-foreground">
				<span>{storesWithCoords} stores on map</span>
				{totalStores > storesWithCoords && (
					<span className="text-amber-600">
						{totalStores - storesWithCoords} without coordinates
					</span>
				)}
			</div>

			<Suspense fallback={<MapSkeleton />}>
				<StoresMapClient markers={markers} />
			</Suspense>
		</div>
	);
}
