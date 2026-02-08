import { catalogEvents } from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

export interface LogCatalogEventInput {
	eventType:
		| "sku_created"
		| "sku_merged"
		| "sku_split"
		| "item_linked"
		| "item_unlinked"
		| "barcode_mapped"
		| "decision_overridden"
		| string;
	entityType: "canonical_sku" | "sku_item_link" | "barcode_mapping" | string;
	entityId: string;
	actorId?: string | null;
	payload: Record<string, unknown>;
}

export async function logCatalogEvent(
	input: LogCatalogEventInput,
): Promise<{ id: string }> {
	const db = getDb();
	const [row] = await db
		.insert(catalogEvents)
		.values({
			eventType: input.eventType,
			entityType: input.entityType,
			entityId: input.entityId,
			actorId: input.actorId ?? null,
			payload: input.payload,
			createdAt: new Date(),
		})
		.returning({ id: catalogEvents.id });

	log.debug("Catalog event logged", {
		id: row.id,
		eventType: input.eventType,
		entityType: input.entityType,
		entityId: input.entityId,
	});

	return { id: row.id };
}
