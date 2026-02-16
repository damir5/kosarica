import { z } from "zod";
import { parseRetailerItemFeature } from "../normalize";
import type {
	BuiltPrompt,
	ExtractionResult,
	ExtractionResultItem,
	GroupItem,
	OfferSpec,
} from "./types";

const EXTRACTION_SCHEMA: BuiltPrompt["jsonSchema"] = {
	name: "offer_spec_extraction",
	schema: {
		type: "object",
		properties: {
			items: {
				type: "array",
				items: {
					type: "object",
					properties: {
						id: { type: "string" },
						brand: { type: ["string", "null"] },
						product: { type: ["string", "null"] },
						variant: { type: ["string", "null"] },
						pack_count: { type: ["number", "null"] },
						unit_size: { type: ["string", "null"] },
						unit_amount_ml_or_g: { type: ["number", "null"] },
						container: { type: ["string", "null"] },
						total_quantity: { type: ["number", "null"] },
						total_amount_ml_or_g: { type: ["number", "null"] },
					},
					required: ["id"],
					additionalProperties: true,
				},
			},
		},
		required: ["items"],
		additionalProperties: true,
	},
};

const BULK_EXTRACTION_SCHEMA: BuiltPrompt["jsonSchema"] = {
	name: "bulk_offer_spec_extraction",
	schema: {
		type: "object",
		properties: {
			groups: {
				type: "array",
				items: {
					type: "object",
					properties: {
						group_id: { type: "string" },
						items: EXTRACTION_SCHEMA.schema.properties.items,
					},
					required: ["group_id", "items"],
					additionalProperties: true,
				},
			},
		},
		required: ["groups"],
		additionalProperties: true,
	},
};

const ExtractionEntrySchema = z.object({
	id: z.string().min(1),
	brand: z.string().nullable().optional(),
	product: z.string().nullable().optional(),
	variant: z.string().nullable().optional(),
	pack_count: z.coerce.number().nullable().optional(),
	unit_size: z.string().nullable().optional(),
	unit_amount_ml_or_g: z.coerce.number().nullable().optional(),
	container: z.string().nullable().optional(),
	total_quantity: z.coerce.number().nullable().optional(),
	total_amount_ml_or_g: z.coerce.number().nullable().optional(),
});

function normalizeText(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function normalizeCount(value: number | null | undefined): number | null {
	if (value == null || !Number.isFinite(value)) {
		return null;
	}
	if (value <= 0) {
		return null;
	}
	return Math.round(value);
}

function normalizeAmount(value: number | null | undefined): number | null {
	if (value == null || !Number.isFinite(value)) {
		return null;
	}
	if (value <= 0) {
		return null;
	}
	return value;
}

function toMlOrG(value: number | null, unit: string | null): number | null {
	if (value == null || unit == null) {
		return null;
	}

	const normalizedUnit = unit.trim().toLowerCase();
	if (normalizedUnit === "ml") {
		return value;
	}
	if (normalizedUnit === "l") {
		return value * 1000;
	}
	if (normalizedUnit === "g") {
		return value;
	}
	if (normalizedUnit === "kg") {
		return value * 1000;
	}
	if (normalizedUnit === "dag" || normalizedUnit === "dkg") {
		return value * 10;
	}
	return null;
}

function fallbackSpec(item: GroupItem): OfferSpec {
	const parsed = parseRetailerItemFeature({
		retailerItemId: item.retailerItemId,
		name: item.rawName,
		brand: item.brand,
		category: item.category,
		unit: item.unit,
		unitQuantity: item.unitQuantity,
	});

	const unitAmountMlOrG = toMlOrG(parsed.unitAmount, parsed.extractedUnit);
	const totalAmountMlOrG = toMlOrG(parsed.totalAmount, parsed.extractedUnit);
	const unitSize =
		parsed.unitAmount != null && parsed.extractedUnit
			? `${parsed.unitAmount}${parsed.extractedUnit}`
			: null;

	return {
		brand: normalizeText(parsed.extractedBrand ?? item.brand),
		product: normalizeText(parsed.normalizedName),
		variant: null,
		packCount: normalizeCount(parsed.packAmount),
		unitSize,
		unitAmountMlOrG,
		container: normalizeText(parsed.containerType ?? item.containerType),
		totalQuantity: parsed.isCountItem
			? normalizeCount(parsed.totalAmount)
			: normalizeCount(parsed.packAmount),
		totalAmountMlOrG,
	};
}

function normalizeOfferSpec(
	entry: z.infer<typeof ExtractionEntrySchema>,
): OfferSpec {
	return {
		brand: normalizeText(entry.brand),
		product: normalizeText(entry.product),
		variant: normalizeText(entry.variant),
		packCount: normalizeCount(entry.pack_count),
		unitSize: normalizeText(entry.unit_size),
		unitAmountMlOrG: normalizeAmount(entry.unit_amount_ml_or_g),
		container: normalizeText(entry.container),
		totalQuantity: normalizeCount(entry.total_quantity),
		totalAmountMlOrG: normalizeAmount(entry.total_amount_ml_or_g),
	};
}

function readEntries(payload: unknown): unknown[] {
	if (Array.isArray(payload)) {
		return payload;
	}
	if (payload && typeof payload === "object") {
		const candidate = payload as {
			items?: unknown;
			results?: unknown;
		};
		if (Array.isArray(candidate.items)) {
			return candidate.items;
		}
		if (Array.isArray(candidate.results)) {
			return candidate.results;
		}
	}
	return [];
}

function readGroupEntries(payload: unknown): unknown[] {
	if (Array.isArray(payload)) {
		return payload;
	}
	if (payload && typeof payload === "object") {
		const candidate = payload as { groups?: unknown; results?: unknown };
		if (Array.isArray(candidate.groups)) {
			return candidate.groups;
		}
		if (Array.isArray(candidate.results)) {
			return candidate.results;
		}
	}
	return [];
}

export function buildExtractionPrompt(
	items: Array<{ id: string; rawName: string }>,
): BuiltPrompt {
	const lines = JSON.stringify(items, null, 2);

	return {
		system: "Return strict JSON only.",
		user: `You are an expert product data analyst for Croatian grocery retail catalogs.
Extract structured offer fields from raw product titles.

Croatian rules:
- "kom" means piece/count.
- "dag" and "dkg" mean 10g.
- Multipacks such as "6x330ml" or "4 x 80 g" must set pack_count and per-unit amount.
- Infer container when possible from terms like: boca, limenka, staklo, pak.
- Keep brand/product/variant conservative and literal from title.

Return JSON only in this shape:
{
  "items": [
    {
      "id": "string",
      "brand": "string|null",
      "product": "string|null",
      "variant": "string|null",
      "pack_count": 1,
      "unit_size": "string|null",
      "unit_amount_ml_or_g": 330,
      "container": "string|null",
      "total_quantity": 1,
      "total_amount_ml_or_g": 330
    }
  ]
}

Items:
${lines}`,
		jsonSchema: EXTRACTION_SCHEMA,
	};
}

export function buildBulkExtractionPrompt(
	groups: Array<{
		groupId: string;
		items: Array<{ id: string; rawName: string }>;
	}>,
): BuiltPrompt {
	const payload = groups.map((group) => ({
		group_id: group.groupId,
		items: group.items,
	}));

	return {
		system: "Return strict JSON only.",
		user: `You are an expert product data analyst for Croatian grocery retail catalogs.
Extract structured offer fields from raw product titles.

Croatian rules:
- "kom" means piece/count.
- "dag" and "dkg" mean 10g.
- Multipacks such as "6x330ml" or "4 x 80 g" must set pack_count and per-unit amount.
- Infer container when possible from terms like: boca, limenka, staklo, pak.
- Keep brand/product/variant conservative and literal from title.

Return JSON only in this shape:
{
  "groups": [
    {
      "group_id": "string",
      "items": [
        {
          "id": "string",
          "brand": "string|null",
          "product": "string|null",
          "variant": "string|null",
          "pack_count": 1,
          "unit_size": "string|null",
          "unit_amount_ml_or_g": 330,
          "container": "string|null",
          "total_quantity": 1,
          "total_amount_ml_or_g": 330
        }
      ]
    }
  ]
}

Groups:
${JSON.stringify(payload, null, 2)}`,
		jsonSchema: BULK_EXTRACTION_SCHEMA,
	};
}

export function parseExtractionResponse(
	raw: unknown,
	groupItems: readonly GroupItem[],
): ExtractionResult {
	const byId = new Map<string, ExtractionResultItem>();
	const entries = readEntries(raw);
	for (const entry of entries) {
		const parsed = ExtractionEntrySchema.safeParse(entry);
		if (!parsed.success) {
			continue;
		}

		const id = parsed.data.id.trim();
		if (id.length === 0) {
			continue;
		}

		byId.set(id, {
			id,
			spec: normalizeOfferSpec(parsed.data),
			source: "llm",
		});
	}

	const items: ExtractionResultItem[] = [];
	const missingItemIds: string[] = [];

	for (const groupItem of groupItems) {
		const found = byId.get(groupItem.retailerItemId);
		if (found) {
			items.push(found);
			continue;
		}

		missingItemIds.push(groupItem.retailerItemId);
		items.push({
			id: groupItem.retailerItemId,
			spec: fallbackSpec(groupItem),
			source: "fallback",
		});
	}

	return {
		items,
		missingItemIds,
	};
}

export function parseBulkExtractionResponse(
	raw: unknown,
	groups: readonly { groupId: string; items: readonly GroupItem[] }[],
): Map<string, ExtractionResult> {
	const byGroupId = new Map<string, unknown>();
	for (const entry of readGroupEntries(raw)) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const record = entry as {
			group_id?: unknown;
			groupId?: unknown;
			items?: unknown;
		};
		const groupId =
			typeof record.group_id === "string"
				? record.group_id.trim()
				: typeof record.groupId === "string"
					? record.groupId.trim()
					: "";
		if (groupId.length === 0) {
			continue;
		}
		byGroupId.set(groupId, record.items);
	}

	const results = new Map<string, ExtractionResult>();
	for (const group of groups) {
		const groupItems = byGroupId.get(group.groupId);
		results.set(
			group.groupId,
			parseExtractionResponse(
				groupItems != null ? { items: groupItems } : { items: [] },
				group.items,
			),
		);
	}
	return results;
}
