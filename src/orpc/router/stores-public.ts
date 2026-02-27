import { and, eq, isNotNull, sql } from "drizzle-orm";
import * as z from "zod";
import { chains, stores } from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { procedure } from "../base";

const EARTH_RADIUS_KM = 6371;

function haversineDistance(
	lat1: number,
	lng1: number,
	lat2: number,
	lng2: number,
): number {
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
	return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const listNearbyStores = procedure
	.input(
		z.object({
			lat: z.number().min(-90).max(90),
			lng: z.number().min(-180).max(180),
			radiusKm: z.number().min(1).max(100).default(10),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();

		const storeRows = await db
			.select({
				id: stores.id,
				name: stores.name,
				displayName: stores.displayName,
				address: stores.address,
				city: stores.city,
				latitude: stores.latitude,
				longitude: stores.longitude,
				chainSlug: stores.chainSlug,
				chainName: chains.name,
				chainLogoUrl: chains.logoUrl,
				priceSourceStoreId: stores.priceSourceStoreId,
			})
			.from(stores)
			.innerJoin(chains, eq(stores.chainSlug, chains.slug))
			.where(
				and(
					eq(stores.isVirtual, false),
					eq(stores.status, "active"),
					isNotNull(stores.latitude),
					isNotNull(stores.longitude),
				),
			);

		const nearby = storeRows
			.map((store) => {
				const latitude = store.latitude;
				const longitude = store.longitude;
				if (!latitude || !longitude) return null;
				const storeLat = Number.parseFloat(latitude);
				const storeLng = Number.parseFloat(longitude);
				if (Number.isNaN(storeLat) || Number.isNaN(storeLng)) return null;
				const distanceKm = haversineDistance(
					input.lat,
					input.lng,
					storeLat,
					storeLng,
				);
				return { ...store, distanceKm: Math.round(distanceKm * 10) / 10 };
			})
			.filter((store) => store != null)
			.filter((store) => store.distanceKm <= input.radiusKm)
			.sort((a, b) => a.distanceKm - b.distanceKm);

		return { stores: nearby };
	});

export const listCities = procedure.handler(async () => {
	const db = getDb();

	const rows = await db
		.select({
			city: stores.city,
			storeCount: sql<number>`count(*)::int`,
			lat: sql<string>`(array_agg(${stores.latitude}))[1]`,
			lng: sql<string>`(array_agg(${stores.longitude}))[1]`,
		})
		.from(stores)
		.where(
			and(
				eq(stores.isVirtual, false),
				eq(stores.status, "active"),
				isNotNull(stores.latitude),
				isNotNull(stores.longitude),
				isNotNull(stores.city),
			),
		)
		.groupBy(stores.city)
		.orderBy(sql`count(*) DESC`);

	const cities = rows
		.filter((row): row is typeof row & { city: string } => row.city != null)
		.map((row) => ({
			city: row.city,
			storeCount: row.storeCount,
			lat: Number.parseFloat(row.lat),
			lng: Number.parseFloat(row.lng),
		}));

	return { cities };
});
