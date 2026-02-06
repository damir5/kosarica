import { clientConfig } from "@/config/clientConfig";
import { capturePostHogEvent } from "@/lib/posthog";

const RECENT_ERRORS_TTL_MS = 60_000;
const recentErrorCache = new Map<string, number>();

export interface ClientErrorPayload {
	errorType: "error" | "unhandledrejection" | "router" | "react";
	message: string;
	stack?: string;
	path: string;
	release: string;
	userAgent: string;
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "Unknown client error";
}

function getErrorStack(error: unknown): string | undefined {
	if (error instanceof Error) return error.stack;
	return undefined;
}

function normalizePayload(
	errorType: ClientErrorPayload["errorType"],
	error: unknown,
): ClientErrorPayload {
	const message = getErrorMessage(error).slice(0, 2048);
	const stack = getErrorStack(error)?.slice(0, 16_384);

	return {
		errorType,
		message,
		stack,
		path: window.location.pathname,
		release: clientConfig.VITE_APP_RELEASE,
		userAgent: navigator.userAgent,
	};
}

function isDuplicate(payload: ClientErrorPayload): boolean {
	const now = Date.now();
	for (const [key, timestamp] of recentErrorCache.entries()) {
		if (now - timestamp > RECENT_ERRORS_TTL_MS) {
			recentErrorCache.delete(key);
		}
	}

	const signature = `${payload.errorType}:${payload.path}:${payload.message}`;
	if (recentErrorCache.has(signature)) {
		return true;
	}
	recentErrorCache.set(signature, now);
	return false;
}

async function postClientError(payload: ClientErrorPayload): Promise<void> {
	const body = JSON.stringify(payload);
	const endpoint = "/api/client-errors";

	if ("sendBeacon" in navigator) {
		const blob = new Blob([body], { type: "application/json" });
		if (navigator.sendBeacon(endpoint, blob)) {
			return;
		}
	}

	await fetch(endpoint, {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		keepalive: true,
		body,
	});
}

export async function reportClientError(
	errorType: ClientErrorPayload["errorType"],
	error: unknown,
): Promise<void> {
	if (typeof window === "undefined") return;

	const payload = normalizePayload(errorType, error);
	if (isDuplicate(payload)) {
		return;
	}

	capturePostHogEvent("client_error", {
		error_type: payload.errorType,
		message: payload.message.slice(0, 200),
		path: payload.path,
		release: payload.release,
	});

	try {
		await postClientError(payload);
	} catch {
		// Don't throw from client-side error capture.
	}
}

export function installGlobalClientErrorHandlers(): () => void {
	if (typeof window === "undefined") {
		return () => {};
	}

	const onError = (event: ErrorEvent) => {
		void reportClientError("error", event.error ?? event.message);
	};

	const onUnhandledRejection = (event: PromiseRejectionEvent) => {
		void reportClientError("unhandledrejection", event.reason);
	};

	window.addEventListener("error", onError);
	window.addEventListener("unhandledrejection", onUnhandledRejection);

	return () => {
		window.removeEventListener("error", onError);
		window.removeEventListener("unhandledrejection", onUnhandledRejection);
	};
}
