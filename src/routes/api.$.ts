import "@/polyfill";

import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createFileRoute } from "@tanstack/react-router";
import router from "@/orpc/router";
import { TodoSchema } from "@/orpc/schema";
import { createLogger } from "@/utils/logger";
import { extractRequestId, runWithContext } from "@/utils/request-context";

const log = createLogger("http");

const handler = new OpenAPIHandler(router, {
	interceptors: [
		onError((error) => {
			log.error("OpenAPI handler error", undefined, error);
		}),
	],
	plugins: [
		new SmartCoercionPlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
			specGenerateOptions: {
				info: {
					title: "TanStack ORPC Playground",
					version: "1.0.0",
				},
				commonSchemas: {
					Todo: { schema: TodoSchema },
					UndefinedError: { error: "UndefinedError" },
				},
				security: [{ bearerAuth: [] }],
				components: {
					securitySchemes: {
						bearerAuth: {
							type: "http",
							scheme: "bearer",
						},
					},
				},
			},
			docsConfig: {
				authentication: {
					securitySchemes: {
						bearerAuth: {
							token: "default-token",
						},
					},
				},
			},
		}),
	],
});

async function handle({ request }: { request: Request }) {
	const requestId = extractRequestId(request);

	return runWithContext(requestId, async () => {
		const start = Date.now();
		const url = new URL(request.url);

		log.info("Request started", {
			method: request.method,
			path: url.pathname,
		});

		const { response } = await handler.handle(request, {
			prefix: "/api",
			context: {},
		});

		const result = response ?? new Response("Not Found", { status: 404 });

		log.info("Request completed", {
			method: request.method,
			path: url.pathname,
			status: result.status,
			duration: Date.now() - start,
		});

		return result;
	});
}

export const Route = createFileRoute("/api/$")({
	server: {
		handlers: {
			HEAD: handle,
			GET: handle,
			POST: handle,
			PUT: handle,
			PATCH: handle,
			DELETE: handle,
		},
	},
});
