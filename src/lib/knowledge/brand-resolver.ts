import type { KnowledgeCatalog, ResolvedBrand } from "./types";
import { normalizeKnowledgeText } from "./utils";

export function resolveBrand(
	rawBrand: string | null | undefined,
	catalog: KnowledgeCatalog,
): ResolvedBrand | null {
	if (!rawBrand) {
		return null;
	}

	const normalized = normalizeKnowledgeText(rawBrand);
	if (!normalized) {
		return null;
	}

	const brandId = catalog.brandAliases.get(normalized);
	if (!brandId) {
		return null;
	}

	const node = catalog.brandsById.get(brandId);
	if (!node) {
		return null;
	}

	const parentBrandId = node.parentBrandId ?? node.id;
	const parentNode = catalog.brandsById.get(parentBrandId) ?? node;

	return {
		brandId: node.id,
		parentBrand: parentNode.id,
		company: node.companyName,
		isPrivateLabel: node.privateLabelFor !== null,
		chain: node.privateLabelFor ?? undefined,
	};
}

export function areSameBrandFamily(
	a: string | null | undefined,
	b: string | null | undefined,
	catalog: KnowledgeCatalog,
): boolean {
	if (!a || !b) {
		return false;
	}

	const resolvedA = resolveBrand(a, catalog);
	const resolvedB = resolveBrand(b, catalog);

	if (resolvedA && resolvedB) {
		if (resolvedA.parentBrand === resolvedB.parentBrand) {
			return true;
		}
		if (
			resolvedA.isPrivateLabel &&
			resolvedB.isPrivateLabel &&
			resolvedA.chain &&
			resolvedA.chain === resolvedB.chain
		) {
			return true;
		}
		return false;
	}

	return normalizeKnowledgeText(a) === normalizeKnowledgeText(b);
}
