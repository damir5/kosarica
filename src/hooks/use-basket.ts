"use client";

import {
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type { StoreSlug } from "@/components/public/domain";

// ============================================================================
// Types
// ============================================================================

export interface BasketItem {
	/** Product ID (prd_ prefix) */
	productId: string;
	name: string;
	quantity: number;
	checked: boolean;
	/** Best price in cents (cached from last product view) */
	bestPrice?: number;
	/** Chain slug of best-price store */
	bestStore?: StoreSlug;
}

// ============================================================================
// Constants
// ============================================================================

const BASKET_KEY = ["basket"] as const;
const STORAGE_KEY = "tk-basket";

// ============================================================================
// LocalStorage helpers
// ============================================================================

function readBasket(): BasketItem[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as BasketItem[]) : [];
	} catch {
		return [];
	}
}

function writeBasket(items: BasketItem[]): void {
	if (typeof window === "undefined") return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

// ============================================================================
// Hook
// ============================================================================

export function useBasket() {
	const queryClient = useQueryClient();

	const { data: items = [] } = useQuery({
		queryKey: BASKET_KEY,
		queryFn: readBasket,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
	});

	function mutate(updater: (prev: BasketItem[]) => BasketItem[]) {
		const prev = queryClient.getQueryData<BasketItem[]>(BASKET_KEY) ?? [];
		const next = updater(prev);
		writeBasket(next);
		queryClient.setQueryData(BASKET_KEY, next);
	}

	const addItem = useMutation({
		mutationFn: async (
			item: Omit<BasketItem, "checked" | "quantity"> & { quantity?: number },
		) => {
			mutate((prev) => {
				const idx = prev.findIndex((i) => i.productId === item.productId);
				if (idx >= 0) {
					const updated = [...prev];
					updated[idx] = {
						...updated[idx],
						quantity: updated[idx].quantity + (item.quantity ?? 1),
					};
					return updated;
				}
				return [
					...prev,
					{
						productId: item.productId,
						name: item.name,
						quantity: item.quantity ?? 1,
						checked: false,
						bestPrice: item.bestPrice,
						bestStore: item.bestStore,
					},
				];
			});
		},
	});

	const removeItem = useMutation({
		mutationFn: async (productId: string) => {
			mutate((prev) => prev.filter((i) => i.productId !== productId));
		},
	});

	const updateQuantity = useMutation({
		mutationFn: async ({
			productId,
			quantity,
		}: { productId: string; quantity: number }) => {
			if (quantity <= 0) {
				mutate((prev) => prev.filter((i) => i.productId !== productId));
				return;
			}
			mutate((prev) =>
				prev.map((i) =>
					i.productId === productId ? { ...i, quantity } : i,
				),
			);
		},
	});

	const toggleChecked = useMutation({
		mutationFn: async (productId: string) => {
			mutate((prev) =>
				prev.map((i) =>
					i.productId === productId ? { ...i, checked: !i.checked } : i,
				),
			);
		},
	});

	const clear = useMutation({
		mutationFn: async () => {
			mutate(() => []);
		},
	});

	return {
		items,
		addItem,
		removeItem,
		updateQuantity,
		toggleChecked,
		clear,
		count: items.length,
		checkedCount: items.filter((i) => i.checked).length,
	};
}
