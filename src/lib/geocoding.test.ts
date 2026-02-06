import { afterEach, describe, expect, it, vi } from "vitest";
import { geocodeAddress } from "./geocoding";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("geocodeAddress confidence", () => {
	it("returns high confidence for exact address with diacritic-insensitive city match", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					features: [
						{
							geometry: { coordinates: [15.8024, 45.8702] },
							properties: {
								street: "Bana Josipa Jelacica",
								housenumber: "139",
								city: "Zaprešić",
								osm_type: "N",
								osm_value: "house",
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);

		const result = await geocodeAddress({
			address: "BANA JOSIPA JELACICA 139",
			city: "Zapresic",
			country: "hr",
		});

		expect(result.found).toBe(true);
		expect(result.confidence).toBe("high");
	});

	it("returns medium confidence for street-level city match", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					features: [
						{
							geometry: { coordinates: [15.9447, 45.7578] },
							properties: {
								street: "Varazdinska",
								city: "Zlatar",
								osm_type: "W",
								osm_value: "road",
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);

		const result = await geocodeAddress({
			address: "VARAZDINSKA 2A",
			city: "Zlatar",
			country: "hr",
		});

		expect(result.found).toBe(true);
		expect(result.confidence).toBe("medium");
	});

	it("returns low confidence when city does not match", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					features: [
						{
							geometry: { coordinates: [15.0001, 45.0001] },
							properties: {
								street: "Some Street",
								city: "Rijeka",
								osm_type: "W",
								osm_value: "road",
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);

		const result = await geocodeAddress({
			address: "Some Street 1",
			city: "Zagreb",
			country: "hr",
		});

		expect(result.found).toBe(true);
		expect(result.confidence).toBe("low");
	});
});
