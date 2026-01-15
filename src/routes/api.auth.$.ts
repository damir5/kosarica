import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { createLogger } from "@/utils/logger";
import { extractRequestId, runWithContext } from "@/utils/request-context";

const log = createLogger("auth");

async function handleAuth({ request }: { request: Request }) {
	const requestId = extractRequestId(request);

	return runWithContext(requestId, async () => {
		const start = Date.now();
		const url = new URL(request.url);

		log.info("Auth request started", {
			method: request.method,
			path: url.pathname,
		});

		try {
			const response = await auth.handler(request);

			log.info("Auth request completed", {
				method: request.method,
				path: url.pathname,
				status: response.status,
				duration: Date.now() - start,
			});

			return response;
		} catch (error) {
			log.error(
				"Auth request failed",
				{
					method: request.method,
					path: url.pathname,
					duration: Date.now() - start,
				},
				error,
			);
			throw error;
		}
	});
}

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: handleAuth,
			POST: handleAuth,
		},
	},
});
