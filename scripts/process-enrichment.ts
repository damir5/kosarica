import { eq, sql } from "drizzle-orm";
import { getDatabase } from "../src/db";
import { storeEnrichmentTasks, stores } from "../src/db/schema";
import { geocodeAddress, type GeocodingInput } from "../src/lib/geocoding";

interface GeocodeTask {
	id: string;
	storeId: string;
	inputData: string | null;
}

async function markTaskFailed(taskId: string, errorMessage: string): Promise<void> {
	const db = getDatabase();
	await db
		.update(storeEnrichmentTasks)
		.set({ status: "failed", errorMessage })
		.where(eq(storeEnrichmentTasks.id, taskId));
}

async function processGeocodeTask(task: GeocodeTask): Promise<{
	success: boolean;
	error?: string;
}> {
	const db = getDatabase();

	await db
		.update(storeEnrichmentTasks)
		.set({ status: "processing" })
		.where(eq(storeEnrichmentTasks.id, task.id));

	const [store] = await db
		.select()
		.from(stores)
		.where(eq(stores.id, task.storeId));

	if (!store) {
		await markTaskFailed(task.id, "Store not found");
		return { success: false, error: "Store not found" };
	}

	try {
		const input: GeocodingInput = {
			address: store.address,
			city: store.city,
			postalCode: store.postalCode,
			country: "hr",
		};

		const geocodeResult = await geocodeAddress(input);
		if (geocodeResult.isErr()) {
			await markTaskFailed(task.id, geocodeResult.error.message);
			return { success: false, error: geocodeResult.error.message };
		}

		const coordinates = geocodeResult.value;
		if (!coordinates.latitude || !coordinates.longitude) {
			await markTaskFailed(task.id, "No coordinates returned");
			return { success: false, error: "No coordinates returned" };
		}

		await db
			.update(stores)
			.set({
				latitude: coordinates.latitude,
				longitude: coordinates.longitude,
				updatedAt: new Date(),
			})
			.where(eq(stores.id, store.id));

		await db
			.update(storeEnrichmentTasks)
			.set({ status: "completed" })
			.where(eq(storeEnrichmentTasks.id, task.id));

		return { success: true };
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		await markTaskFailed(task.id, errorMessage);
		return { success: false, error: errorMessage };
	}
}

async function main(): Promise<void> {
	const db = getDatabase();
	const batchSize = 10;
	let processed = 0;
	let success = 0;
	let failed = 0;

	console.log("Starting geocoding enrichment processing...");

	while (true) {
		const tasks = await db
			.select({
				id: storeEnrichmentTasks.id,
				storeId: storeEnrichmentTasks.storeId,
				inputData: storeEnrichmentTasks.inputData,
			})
			.from(storeEnrichmentTasks)
			.where(eq(storeEnrichmentTasks.status, "pending"))
			.limit(batchSize);

		if (tasks.length === 0) {
			console.log("No more pending tasks");
			break;
		}

		for (const task of tasks) {
			const result = await processGeocodeTask(task);
			processed += 1;
			if (result.success) {
				success += 1;
				console.log(`[${processed}] Geocoded store ${task.storeId}`);
			} else {
				failed += 1;
				console.log(
					`[${processed}] Failed for store ${task.storeId}: ${result.error}`,
				);
			}

			await new Promise((resolve) => {
				setTimeout(resolve, 200);
			});
		}

		console.log(
			`Progress: ${processed} processed, ${success} success, ${failed} failed`,
		);
	}

	console.log("\n=== Final Stats ===");
	console.log(`Total processed: ${processed}`);
	console.log(`Success: ${success}`);
	console.log(`Failed: ${failed}`);

	const remaining = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(storeEnrichmentTasks)
		.where(eq(storeEnrichmentTasks.status, "pending"));
	console.log(`Remaining pending: ${remaining[0]?.count ?? 0}`);
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
