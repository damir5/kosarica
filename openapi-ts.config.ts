import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
	input: "http://localhost:3003/docs/doc.json",
	output: {
		path: "src/lib/go-api",
		format: "prettier",
	},
	plugins: [
		"@hey-api/typescript",
		"@hey-api/sdk",
		{
			name: "zod",
			exportFromIndex: true,
		},
	],
});
