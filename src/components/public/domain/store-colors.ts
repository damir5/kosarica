export const STORE_COLORS = {
	konzum: "#e31e24",
	lidl: "#0050aa",
	plodine: "#f7941d",
	kaufland: "#e30613",
	spar: "#00874a",
	studenac: "#0066b2",
	eurospin: "#ffd100",
	tommy: "#c8102e",
	ktc: "#1a5ca1",
	dm: "#002f5f",
	interspar: "#00874a",
} as const;

export type StoreSlug = keyof typeof STORE_COLORS;

export const STORE_DISPLAY_NAMES: Record<StoreSlug, string> = {
	konzum: "Konzum",
	lidl: "Lidl",
	plodine: "Plodine",
	kaufland: "Kaufland",
	spar: "Spar",
	studenac: "Studenac",
	eurospin: "Eurospin",
	tommy: "Tommy",
	ktc: "KTC",
	dm: "DM",
	interspar: "Interspar",
};
