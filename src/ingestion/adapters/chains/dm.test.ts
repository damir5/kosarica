import { describe, expect, it } from "vitest";
import { extractDmPriceListUrlsFromPortalContent } from "./dm";

describe("DmAdapter portal content URL extraction", () => {
	it("extracts and orders DM price list URLs by version", () => {
		const payload = JSON.stringify({
			type: "Page",
			mainData: [
				{
					type: "DMDownload",
					data: {
						link: "/resource/blob/3310754/69d6ee3c37a99cff920171264bdc7e5f/vlada-oznacavanje-cijena-cijenik-286-data.xlsx",
					},
				},
				{
					type: "DMDownload",
					data: {
						link: "/resource/blob/3313222/4aaf2c31bedeab05991d984b2eb0b59c/vlada-oznacavanje-cijena-cijenik-287-data.xlsx",
					},
				},
			],
		});

		const urls = extractDmPriceListUrlsFromPortalContent(payload);

		expect(urls).toEqual([
			"https://content.services.dmtech.com/rootpage-dm-shop-hr-hr/resource/blob/3313222/4aaf2c31bedeab05991d984b2eb0b59c/vlada-oznacavanje-cijena-cijenik-287-data.xlsx",
			"https://content.services.dmtech.com/rootpage-dm-shop-hr-hr/resource/blob/3310754/69d6ee3c37a99cff920171264bdc7e5f/vlada-oznacavanje-cijena-cijenik-286-data.xlsx",
		]);
	});

	it("keeps absolute URLs and ignores non-cjenik xlsx links", () => {
		const payload = JSON.stringify({
			values: [
				"https://content.services.dmtech.com/rootpage-dm-shop-hr-hr/resource/blob/3313222/4aaf2c31bedeab05991d984b2eb0b59c/vlada-oznacavanje-cijena-cijenik-287-data.xlsx",
				"https://example.invalid/file.xlsx",
				"/resource/blob/2906702/e328b01668f5c1ce2fc1542d680548ce/vlada-oznacavanje-cijena-etiketa-data.png",
			],
		});

		const urls = extractDmPriceListUrlsFromPortalContent(payload);

		expect(urls).toEqual([
			"https://content.services.dmtech.com/rootpage-dm-shop-hr-hr/resource/blob/3313222/4aaf2c31bedeab05991d984b2eb0b59c/vlada-oznacavanje-cijena-cijenik-287-data.xlsx",
		]);
	});

	it("returns an empty list for malformed payload", () => {
		const urls = extractDmPriceListUrlsFromPortalContent("{bad-json");
		expect(urls).toEqual([]);
	});
});
