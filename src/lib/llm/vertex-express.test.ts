import { describe, expect, it } from "vitest";
import {
	buildVertexExpressUrl,
	extractVertexText,
	extractVertexUsage,
	toVertexExpressModelPath,
} from "./vertex-express";

describe("vertex-express", () => {
	it("normalizes short model ids to publishers/google/models", () => {
		expect(toVertexExpressModelPath("gemini-2.5-flash")).toBe(
			"publishers/google/models/gemini-2.5-flash",
		);
	});

	it("keeps publisher model paths intact", () => {
		expect(
			toVertexExpressModelPath("publishers/google/models/gemini-2.5-flash"),
		).toBe("publishers/google/models/gemini-2.5-flash");
	});

	it("builds generateContent URL and redacts API key", () => {
		const { url, redacted } = buildVertexExpressUrl({
			baseEndpoint: "https://aiplatform.googleapis.com/v1",
			model: "gemini-2.5-flash",
			apiKey: "secret",
		});

		expect(url).toContain(":generateContent?key=");
		expect(url).toContain("secret");
		expect(redacted).not.toContain("secret");
		expect(redacted).toContain("key=REDACTED");
	});

	it("extracts candidate text from Vertex responses", () => {
		const text = extractVertexText({
			candidates: [
				{
					content: {
						parts: [{ text: "hello " }, { text: "world" }],
					},
				},
			],
		});

		expect(text).toBe("hello world");
	});

	it("extracts token usage when present", () => {
		const usage = extractVertexUsage({
			usageMetadata: {
				promptTokenCount: 10,
				candidatesTokenCount: 20,
				totalTokenCount: 30,
			},
		});

		expect(usage).toEqual({
			promptTokens: 10,
			completionTokens: 20,
			totalTokens: 30,
		});
	});
});

