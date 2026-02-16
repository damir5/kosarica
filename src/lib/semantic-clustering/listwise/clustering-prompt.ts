import { z } from "zod";
import type {
	BuiltPrompt,
	ClusteringPromptItem,
	ClusteringResult,
	GroupItem,
} from "./types";

const CLUSTERING_SCHEMA: BuiltPrompt["jsonSchema"] = {
	name: "offer_cluster_output",
	schema: {
		type: "object",
		properties: {
			base_products: {
				type: "array",
				items: {
					type: "object",
					properties: {
						base_id: { type: "string" },
						canonical_name: { type: "string" },
						brand: { type: ["string", "null"] },
						category: { type: ["string", "null"] },
						pack_variants: {
							type: "array",
							items: {
								type: "object",
								properties: {
									variant_key: { type: "string" },
									variant_label: { type: "string" },
									item_ids: {
										type: "array",
										items: { type: "string" },
									},
									unit_size: { type: ["string", "null"] },
									pack_count: { type: ["number", "null"] },
									container: { type: ["string", "null"] },
								},
								required: ["variant_key", "variant_label", "item_ids"],
								additionalProperties: true,
							},
						},
					},
					required: ["base_id", "canonical_name", "pack_variants"],
					additionalProperties: true,
				},
			},
			unclassified: {
				type: "array",
				items: { type: "string" },
			},
			confidence: { type: ["number", "null"] },
			reasoning: { type: ["string", "null"] },
		},
		required: ["base_products", "unclassified"],
		additionalProperties: true,
	},
};

const BULK_CLUSTERING_SCHEMA: BuiltPrompt["jsonSchema"] = {
	name: "bulk_offer_cluster_output",
	schema: {
		type: "object",
		properties: {
			groups: {
				type: "array",
				items: {
					type: "object",
					properties: {
						group_id: { type: "string" },
						base_products: CLUSTERING_SCHEMA.schema.properties.base_products,
						unclassified: CLUSTERING_SCHEMA.schema.properties.unclassified,
						confidence: CLUSTERING_SCHEMA.schema.properties.confidence,
						reasoning: CLUSTERING_SCHEMA.schema.properties.reasoning,
					},
					required: ["group_id", "base_products", "unclassified"],
					additionalProperties: true,
				},
			},
		},
		required: ["groups"],
		additionalProperties: true,
	},
};

const VariantSchema = z.object({
	variant_key: z.string().min(1),
	variant_label: z.string().min(1),
	item_ids: z.array(z.string().min(1)).default([]),
	unit_size: z.string().nullable().optional(),
	pack_count: z.coerce.number().nullable().optional(),
	container: z.string().nullable().optional(),
});

const BaseProductSchema = z.object({
	base_id: z.string().min(1),
	canonical_name: z.string().min(1),
	brand: z.string().nullable().optional(),
	category: z.string().nullable().optional(),
	pack_variants: z.array(VariantSchema).default([]),
});

const TopLevelSchema = z.object({
	base_products: z.array(BaseProductSchema).default([]),
	unclassified: z.array(z.string().min(1)).default([]),
	confidence: z.coerce.number().nullable().optional(),
	reasoning: z.string().nullable().optional(),
});

function normalizeText(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function normalizePackCount(value: number | null | undefined): number | null {
	if (value == null || !Number.isFinite(value) || value <= 0) {
		return null;
	}
	return Math.round(value);
}

function normalizeConfidence(value: number | null | undefined): number {
	if (value == null || !Number.isFinite(value)) {
		return 0;
	}
	if (value > 1) {
		return Math.min(1, value / 100);
	}
	return Math.max(0, value);
}

function toInputArray(payload: unknown): unknown {
	if (Array.isArray(payload)) {
		return {
			base_products: payload,
			unclassified: [],
		};
	}
	if (payload && typeof payload === "object") {
		return payload;
	}
	return {
		base_products: [],
		unclassified: [],
	};
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

export function buildClusteringPrompt(
	items: readonly ClusteringPromptItem[],
): BuiltPrompt {
	const lines = JSON.stringify(items, null, 2);

	return {
		system: "Return strict JSON only.",
		user: `You are an expert product clustering system for Croatian grocery retail.
Cluster items into base products and pack variants.

Definitions:
- Base Product: abstract product concept (brand + product + flavor/variant family).
- Pack Variant: same base product but different size, pack count, or container.

Rules:
1) Different brands are always different base products.
2) Different flavors/variants are different base products.
3) Same physical product across different chains should be grouped together.
4) Use price ratio as a hint, not a hard rule (2x volume often means ~2x price).
5) Be conservative: prefer splitting over merging when uncertain.

Return JSON only in this shape:
{
  "base_products": [
    {
      "base_id": "string",
      "canonical_name": "string",
      "brand": "string|null",
      "category": "string|null",
      "pack_variants": [
        {
          "variant_key": "string",
          "variant_label": "string",
          "item_ids": ["id1", "id2"],
          "unit_size": "string|null",
          "pack_count": 1,
          "container": "string|null"
        }
      ]
    }
  ],
  "unclassified": ["id3"],
  "confidence": 0.0,
  "reasoning": "short explanation"
}

Items:
${lines}`,
		jsonSchema: CLUSTERING_SCHEMA,
	};
}

export function buildBulkClusteringPrompt(
	groups: Array<{ groupId: string; items: readonly ClusteringPromptItem[] }>,
): BuiltPrompt {
	const payload = groups.map((group) => ({
		group_id: group.groupId,
		items: group.items,
	}));

	return {
		system: "Return strict JSON only.",
		user: `You are an expert product clustering system for Croatian grocery retail.
For each group independently, cluster items into base products and pack variants.

Definitions:
- Base Product: abstract product concept (brand + product + flavor/variant family).
- Pack Variant: same base product but different size, pack count, or container.

Rules:
1) Different brands are always different base products.
2) Different flavors/variants are different base products.
3) Same physical product across different chains should be grouped together.
4) Use price ratio as a hint, not a hard rule (2x volume often means ~2x price).
5) Be conservative: prefer splitting over merging when uncertain.

Return JSON only in this shape:
{
  "groups": [
    {
      "group_id": "string",
      "base_products": [
        {
          "base_id": "string",
          "canonical_name": "string",
          "brand": "string|null",
          "category": "string|null",
          "pack_variants": [
            {
              "variant_key": "string",
              "variant_label": "string",
              "item_ids": ["id1", "id2"],
              "unit_size": "string|null",
              "pack_count": 1,
              "container": "string|null"
            }
          ]
        }
      ],
      "unclassified": ["id3"],
      "confidence": 0.0,
      "reasoning": "short explanation"
    }
  ]
}

Groups:
${JSON.stringify(payload, null, 2)}`,
		jsonSchema: BULK_CLUSTERING_SCHEMA,
	};
}

export function parseClusteringResponse(
	raw: unknown,
	groupItems: readonly GroupItem[],
): ClusteringResult {
	const parsedTopLevel = TopLevelSchema.safeParse(toInputArray(raw));
	if (!parsedTopLevel.success) {
		const expectedIds = groupItems.map((item) => item.retailerItemId);
		return {
			baseProducts: [],
			unclassified: expectedIds,
			confidence: 0,
			reasoning: "Invalid clustering response JSON; all items unclassified.",
			missingItemIds: expectedIds,
			duplicateItemIds: [],
		};
	}

	const expectedIds = new Set(groupItems.map((item) => item.retailerItemId));
	const assigned = new Set<string>();
	const duplicateItemIds: string[] = [];

	const baseProducts = parsedTopLevel.data.base_products.map((baseProduct) => {
		const packVariants = baseProduct.pack_variants.map((variant) => {
			const itemIds: string[] = [];
			for (const rawId of variant.item_ids) {
				const id = rawId.trim();
				if (!expectedIds.has(id)) {
					continue;
				}
				if (assigned.has(id)) {
					duplicateItemIds.push(id);
					continue;
				}
				assigned.add(id);
				itemIds.push(id);
			}

			return {
				variantKey: variant.variant_key,
				variantLabel: variant.variant_label,
				itemIds,
				unitSize: normalizeText(variant.unit_size),
				packCount: normalizePackCount(variant.pack_count),
				container: normalizeText(variant.container),
			};
		});

		return {
			baseId: baseProduct.base_id,
			canonicalName: baseProduct.canonical_name,
			brand: normalizeText(baseProduct.brand),
			category: normalizeText(baseProduct.category),
			packVariants,
		};
	});

	const unclassified = Array.from(
		new Set(
			parsedTopLevel.data.unclassified
				.map((itemId) => itemId.trim())
				.filter((itemId) => itemId.length > 0)
				.filter((itemId) => expectedIds.has(itemId))
				.filter((itemId) => !assigned.has(itemId)),
		),
	);

	const missingItemIds = Array.from(expectedIds).filter(
		(itemId) => !assigned.has(itemId) && !unclassified.includes(itemId),
	);

	return {
		baseProducts,
		unclassified: [...unclassified, ...missingItemIds],
		confidence: normalizeConfidence(parsedTopLevel.data.confidence),
		reasoning:
			normalizeText(parsedTopLevel.data.reasoning) ??
			"No reasoning provided by model.",
		missingItemIds,
		duplicateItemIds: Array.from(new Set(duplicateItemIds)),
	};
}

export function parseBulkClusteringResponse(
	raw: unknown,
	groups: readonly { groupId: string; items: readonly GroupItem[] }[],
): Map<string, ClusteringResult> {
	const byGroupId = new Map<string, unknown>();
	for (const entry of readGroupEntries(raw)) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const record = entry as { group_id?: unknown; groupId?: unknown };
		const groupId =
			typeof record.group_id === "string"
				? record.group_id.trim()
				: typeof record.groupId === "string"
					? record.groupId.trim()
					: "";
		if (groupId.length === 0) {
			continue;
		}
		byGroupId.set(groupId, record);
	}

	const results = new Map<string, ClusteringResult>();
	for (const group of groups) {
		const entry = byGroupId.get(group.groupId);
		results.set(
			group.groupId,
			parseClusteringResponse(entry ?? {}, group.items),
		);
	}
	return results;
}
