import { describe, expect, it } from "vitest";
import { parseEnsembleConfig } from "./config";
import { parseRetailerItemFeature } from "./normalize";

describe("parseRetailerItemFeature", () => {
	it("parses multipack liquids and container hints", () => {
		const parsed = parseRetailerItemFeature({
			retailerItemId: "rit_test",
			name: "Coca Cola 6x330ml limenka",
			brand: null,
			category: "Piće",
			unit: null,
			unitQuantity: null,
		});

		expect(parsed.isMultipack).toBe(true);
		expect(parsed.packAmount).toBe(6);
		expect(parsed.extractedUnit).toBe("l");
		expect(parsed.totalAmount).toBeCloseTo(1.98, 2);
		expect(parsed.containerType).toBe("limenka");
	});

	it("detects pack counts from slash format", () => {
		const parsed = parseRetailerItemFeature({
			retailerItemId: "rit_test_2",
			name: "Jaja L 10/1",
			brand: null,
			category: "Hrana",
			unit: null,
			unitQuantity: null,
		});

		expect(parsed.packAmount).toBe(10);
		expect(parsed.isMultipack).toBe(true);
	});
});

describe("parseEnsembleConfig", () => {
	it("fills default endpoints and api key env names", () => {
		const config = parseEnsembleConfig(
			JSON.stringify([
				{
					id: "primary",
					provider: "openai",
					model: "gpt-4o-mini",
				},
			]),
		);

		expect(config).toHaveLength(1);
		expect(config[0].endpoint).toContain("openai.com");
		expect(config[0].apiKeyEnv).toBe("OPENAI_API_KEY");
	});

	it("rejects loopback endpoints in production by default", () => {
		const previousNodeEnv = process.env.NODE_ENV;
		const previousOverride = process.env.ALLOW_LOOPBACK_LLM_ENDPOINT;
		try {
			process.env.NODE_ENV = "production";
			delete process.env.ALLOW_LOOPBACK_LLM_ENDPOINT;

			expect(() =>
				parseEnsembleConfig(
					JSON.stringify([
						{
							id: "local",
							provider: "openai",
							model: "qwen/qwen3-4b",
							endpoint: "http://127.0.0.1:1234/v1/chat/completions",
						},
					]),
				),
			).toThrow("Unsafe LLM endpoint");
		} finally {
			process.env.NODE_ENV = previousNodeEnv;
			if (previousOverride === undefined) {
				delete process.env.ALLOW_LOOPBACK_LLM_ENDPOINT;
			} else {
				process.env.ALLOW_LOOPBACK_LLM_ENDPOINT = previousOverride;
			}
		}
	});

	it("allows loopback endpoints in production with explicit override", () => {
		const previousNodeEnv = process.env.NODE_ENV;
		const previousOverride = process.env.ALLOW_LOOPBACK_LLM_ENDPOINT;
		try {
			process.env.NODE_ENV = "production";
			process.env.ALLOW_LOOPBACK_LLM_ENDPOINT = "true";

			const config = parseEnsembleConfig(
				JSON.stringify([
					{
						id: "local",
						provider: "openai",
						model: "qwen/qwen3-4b",
						endpoint: "http://127.0.0.1:1234/v1/chat/completions",
					},
				]),
			);
			expect(config[0].endpoint).toBe(
				"http://127.0.0.1:1234/v1/chat/completions",
			);
		} finally {
			process.env.NODE_ENV = previousNodeEnv;
			if (previousOverride === undefined) {
				delete process.env.ALLOW_LOOPBACK_LLM_ENDPOINT;
			} else {
				process.env.ALLOW_LOOPBACK_LLM_ENDPOINT = previousOverride;
			}
		}
	});
});
