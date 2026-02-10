import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";
import router from "@/orpc/router";
import { TodoSchema } from "@/orpc/schema";
import { createLogger } from "@/utils/logger";
import { getReleaseMetadata } from "@/utils/release";
import { extractRequestId, runWithContext } from "@/utils/request-context";

const log = createLogger("http");
const release = getReleaseMetadata();

const ClientErrorPayloadSchema = z.object({
	errorType: z.enum(["error", "unhandledrejection", "router", "react"]),
	message: z.string().min(1).max(2048),
	stack: z.string().max(16384).optional(),
	path: z.string().min(1).max(1024),
	release: z.string().min(1).max(128),
	userAgent: z.string().min(1).max(512),
});

const rumLog = createLogger("rum");

const RumPayloadSchema = z.object({
	name: z.enum(["CLS", "INP", "LCP", "TTFB", "FCP"]),
	value: z.number(),
	rating: z.enum(["good", "needs-improvement", "poor"]),
	delta: z.number(),
	id: z.string().max(128),
	navigationType: z.string().max(64).optional(),
	path: z.string().min(1).max(1024),
	release: z.string().max(128).optional(),
	userAgent: z.string().max(512).optional(),
});

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
	const url = new URL(request.url);

	if (url.pathname === "/api/client-errors") {
		return handleClientErrorIngest(request, requestId);
	}

	if (url.pathname === "/api/rum") {
		return handleRumIngest(request, requestId);
	}

	return runWithContext(requestId, async () => {
		const start = Date.now();

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

async function handleClientErrorIngest(
	request: Request,
	requestId: string,
): Promise<Response> {
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", { status: 405 });
	}

	return runWithContext(requestId, async () => {
		try {
			const rawBody = await request.text();
			if (rawBody.length > 20_000) {
				log.warn("Dropped oversized client error payload", {
					maxBytes: 20_000,
					receivedBytes: rawBody.length,
				});
				return new Response(null, { status: 204 });
			}

			const parsedJson: unknown = JSON.parse(rawBody);
			const parsed = ClientErrorPayloadSchema.safeParse(parsedJson);
			if (!parsed.success) {
				log.warn("Invalid client error payload", {
					issues: parsed.error.issues.map((issue) => ({
						message: issue.message,
						path: issue.path.join("."),
					})),
				});
				return new Response(null, { status: 204 });
			}

			const payload = parsed.data;
			log.error("Client runtime error captured", {
				clientErrorType: payload.errorType,
				clientPath: payload.path,
				clientMessage: payload.message,
				clientStack: payload.stack,
				clientRelease: payload.release,
				serverRelease: release.release,
				userAgent: payload.userAgent,
			});
		} catch (error) {
			log.error("Failed to ingest client error payload", undefined, error);
		}

		return new Response(null, { status: 204 });
	});
}

async function handleRumIngest(
	request: Request,
	requestId: string,
): Promise<Response> {
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", { status: 405 });
	}

	return runWithContext(requestId, async () => {
		try {
			const rawBody = await request.text();
			if (rawBody.length > 4_000) {
				return new Response(null, { status: 204 });
			}

			const parsedJson: unknown = JSON.parse(rawBody);
			const parsed = RumPayloadSchema.safeParse(parsedJson);
			if (!parsed.success) {
				return new Response(null, { status: 204 });
			}

			const m = parsed.data;
			rumLog.info("Web Vital", {
				metric: m.name,
				value: m.value,
				rating: m.rating,
				delta: m.delta,
				metricId: m.id,
				navigationType: m.navigationType,
				clientPath: m.path,
				clientRelease: m.release,
				serverRelease: release.release,
			});
		} catch {
			// RUM ingest is best-effort
		}

		return new Response(null, { status: 204 });
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
