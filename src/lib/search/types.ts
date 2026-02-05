export type SearchEntityType = "product" | "item" | "store";

export interface IndexedEntity {
	entityType: SearchEntityType;
	entityId: string;
	chainSlug: string | null;
	category: string | null;
	subcategory: string | null;
	title: string;
	subtitle: string | null;
	body: string | null;
	imageUrl: string | null;
}

export interface AutocompleteResult {
	id: string;
	entityType: SearchEntityType;
	entityId: string;
	title: string;
	subtitle: string | null;
	imageUrl: string | null;
}

export interface FullSearchResult extends AutocompleteResult {
	chainSlug: string | null;
	category: string | null;
	body: string | null;
	score: number;
	highlights: {
		title: string | null;
		body: string | null;
	};
}

export interface SearchFilters {
	entityTypes?: SearchEntityType[];
	chainSlug?: string;
	category?: string;
}
