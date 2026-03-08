import { describe, expect, it } from "vitest";
import {
	classifyCommodityItem,
	type CommodityClassificationInput,
} from "./commodity-linking";

function buildInput(
	overrides: Partial<CommodityClassificationInput>,
): CommodityClassificationInput {
	return {
		name: "Đumbir rinfuza",
		category: "Hrana",
		subcategory: "Povrće",
		normalizedUnit: "kg",
		normalizedQuantity: 0.25,
		featureCategory: null,
		featureEverydayName: null,
		featureProductType: null,
		featureVariant: null,
		featureExtractedUnit: null,
		featureTotalAmount: null,
		...overrides,
	};
}

describe("classifyCommodityItem", () => {
	it("maps fresh ginger to a single base commodity without pack-size variants", () => {
		expect(classifyCommodityItem(buildInput({}))).toEqual({
			baseName: "Đumbir",
			productType: "povrće",
			variantName: null,
			normalizedQuantity: 0.25,
		});
	});

	it("keeps organic produce as a variant", () => {
		expect(
			classifyCommodityItem(
				buildInput({
					name: "Natur Pur bio đumbir 250 g",
					normalizedUnit: null,
					normalizedQuantity: null,
					featureExtractedUnit: "g",
					featureTotalAmount: 250,
				}),
			),
		).toEqual({
			baseName: "Đumbir",
			productType: "povrće",
			variantName: "Đumbir Bio",
			normalizedQuantity: 0.25,
		});
	});

	it("rejects processed ginger products", () => {
		expect(
			classifyCommodityItem(
				buildInput({
					name: "Yogi Tea ginger",
					category: "Piće",
					subcategory: "Čaj",
					normalizedUnit: null,
					normalizedQuantity: null,
				}),
			),
		).toBeNull();
	});

	it("rejects branded ginger candy and snack products even when the commodity name appears", () => {
		expect(
			classifyCommodityItem(
				buildInput({
					name: "Ricola biljni bomb. ginger orange m.40 g",
					category: "Hrana",
					subcategory: "Bomboni",
					normalizedUnit: null,
					normalizedQuantity: null,
					featureExtractedUnit: "g",
					featureTotalAmount: 40,
				}),
			),
		).toBeNull();

		expect(
			classifyCommodityItem(
				buildInput({
					name: "HO PINK ĐUMBIR 190g",
					category: null,
					subcategory: null,
					normalizedUnit: null,
					normalizedQuantity: null,
					featureExtractedUnit: "g",
					featureTotalAmount: 190,
				}),
			),
		).toBeNull();
	});

	it("treats garlic separately from onion", () => {
		expect(
			classifyCommodityItem(
				buildInput({
					name: "Bijeli luk",
					category: "Hrana",
					subcategory: "Povrće",
				}),
			),
		).toEqual({
			baseName: "Češnjak",
			productType: "povrće",
			variantName: null,
			normalizedQuantity: 0.25,
		});
	});

	it("rejects garlic-flavored packaged goods and spice products", () => {
		expect(
			classifyCommodityItem(
				buildInput({
					name: "BAKE ROLLS ČEŠNJAK 80g",
					category: "Grickalice",
					subcategory: "Slani snack",
					normalizedUnit: null,
					normalizedQuantity: null,
					featureExtractedUnit: "g",
					featureTotalAmount: 80,
				}),
			),
		).toBeNull();

		expect(
			classifyCommodityItem(
				buildInput({
					name: "ZAČIN ČEŠNJAK GRANULE 30g",
					category: "Začini",
					subcategory: "Suhi začini",
					normalizedUnit: null,
					normalizedQuantity: null,
					featureExtractedUnit: "g",
					featureTotalAmount: 30,
				}),
			),
		).toBeNull();
	});

	it("creates a human-facing onion variety variant when needed", () => {
		expect(
			classifyCommodityItem(
				buildInput({
					name: "Crveni luk",
					category: "Hrana",
					subcategory: "Povrće",
				}),
			),
		).toEqual({
			baseName: "Luk",
			productType: "povrće",
			variantName: "Luk Crveni",
			normalizedQuantity: 0.25,
		});
	});

	it("rejects adjacent onion-family products that humans would not treat as the same thing", () => {
		expect(
			classifyCommodityItem(
				buildInput({
					name: "Luk srebrenac",
					category: "Hrana",
					subcategory: "Povrće",
				}),
			),
		).toBeNull();

		expect(
			classifyCommodityItem(
				buildInput({
					name: "Mladi luk",
					category: "Hrana",
					subcategory: "Povrće",
				}),
			),
		).toBeNull();
	});

	it("rejects processed produce rows even when categorization features still mention the commodity", () => {
		expect(
			classifyCommodityItem(
				buildInput({
					name: "FERMENTIR.ĐUMBIR VITAL 100 g",
					normalizedUnit: null,
					normalizedQuantity: null,
					featureCategory: "hrana",
					featureEverydayName: "SPAR Vital fermentirani đumbir",
					featureProductType: "fermentirano povrće",
				}),
			),
		).toBeNull();

		expect(
			classifyCommodityItem(
				buildInput({
					name: "ĐUMBIR KOMADI 100G -HOD",
					normalizedUnit: null,
					normalizedQuantity: null,
					featureCategory: "hrana",
					featureEverydayName: "Đumbir komadi",
					featureProductType: "povrće",
				}),
			),
		).toBeNull();

		expect(
			classifyCommodityItem(
				buildInput({
					name: "KAPULICE SREBRNI LUK 290G/150G NATURETA",
					normalizedUnit: null,
					normalizedQuantity: null,
					featureCategory: "hrana",
					featureEverydayName: "Natureta kapulice srebrni luk",
					featureProductType: "kuhano povrće",
					featureVariant: "srebrni luk",
				}),
			),
		).toBeNull();

		expect(
			classifyCommodityItem(
				buildInput({
					name: "1KG MC LUK CRVENI REZANI",
					normalizedUnit: null,
					normalizedQuantity: null,
					featureCategory: "hrana",
					featureEverydayName: "Metro Chef luk crveni rezani",
					featureProductType: "povrće",
					featureVariant: "crveni rezani",
				}),
			),
		).toBeNull();
	});

	it("handles reordered onion wording and lila onions in a human-facing way", () => {
		expect(
			classifyCommodityItem(
				buildInput({
					name: "Luk mladi rfs",
					normalizedUnit: null,
					normalizedQuantity: null,
				}),
			),
		).toBeNull();

		expect(
			classifyCommodityItem(
				buildInput({
					name: "LUK LILA",
					normalizedUnit: null,
					normalizedQuantity: null,
				}),
			),
		).toEqual({
			baseName: "Luk",
			productType: "povrće",
			variantName: "Luk Crveni",
			normalizedQuantity: null,
		});
	});

	it("rejects weighted produce rows that still look like opaque supplier variants instead of simple human labels", () => {
		expect(
			classifyCommodityItem(
				buildInput({
					name: "200G LAN - VC",
					normalizedUnit: "kg",
					normalizedQuantity: 0.2,
					featureCategory: "hrana",
					featureEverydayName: "Vedrini luk - vrhnjača",
					featureProductType: "povrće",
					featureVariant: "vrhnjača",
				}),
			),
		).toBeNull();

		expect(
			classifyCommodityItem(
				buildInput({
					name: "500G LUK GUARNICION",
					normalizedUnit: "kg",
					normalizedQuantity: 0.5,
					featureCategory: "hrana",
					featureEverydayName: "Luk Garnicion",
					featureProductType: "povrće",
				}),
			),
		).toBeNull();

		expect(
			classifyCommodityItem(
				buildInput({
					name: "CCA5KG MC LIG PAT NEOČ C411-14",
					normalizedUnit: "kg",
					normalizedQuantity: 5,
					featureCategory: "hrana",
					featureEverydayName: "Metro Chef luk patljažani neočišćeni",
					featureProductType: "povrće",
					featureVariant: "neočišćeni",
				}),
			),
		).toBeNull();

		expect(
			classifyCommodityItem(
				buildInput({
					name: "1 KG LUK LJUBIČASTI - VC",
					normalizedUnit: "kg",
					normalizedQuantity: 1,
				}),
			),
		).toEqual({
			baseName: "Luk",
			productType: "povrće",
			variantName: "Luk Crveni",
			normalizedQuantity: 1,
		});
	});

	it("uses categorization features when raw ingestion fields are incomplete", () => {
		expect(
			classifyCommodityItem(
				buildInput({
					name: "KBio",
					category: null,
					subcategory: null,
					normalizedUnit: null,
					normalizedQuantity: null,
					featureEverydayName: "Đumbir",
					featureProductType: "Povrće",
					featureExtractedUnit: "g",
					featureTotalAmount: 300,
				}),
			),
		).toEqual({
			baseName: "Đumbir",
			productType: "povrće",
			variantName: null,
			normalizedQuantity: 0.3,
		});
	});
});
