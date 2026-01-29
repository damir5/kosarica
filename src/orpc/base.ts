import { os, ValidationError } from "@orpc/server";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { user } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/utils/bindings";
import { createLogger, errorToObject } from "@/utils/logger";

const log = createLogger("rpc");

function isApiValidationError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}

	const apiError = error as {
		name?: string;
		status?: number | string;
		statusCode?: number;
		body?: { code?: string };
	};
	const statusCode =
		typeof apiError.statusCode === "number"
			? apiError.statusCode
			: typeof apiError.status === "number"
				? apiError.status
				: undefined;

	return (
		apiError.name === "APIError" &&
		statusCode === 400 &&
		apiError.body?.code === "VALIDATION_ERROR"
	);
}

function isValidationError(error: unknown): boolean {
	if (error instanceof ValidationError) {
		return true;
	}

	if (isApiValidationError(error)) {
		return true;
	}

	if (error && typeof error === "object" && "cause" in error) {
		const cause = (error as { cause?: unknown }).cause;
		if (cause && cause !== error) {
			return isValidationError(cause);
		}
	}

	return false;
}

/**
 * Base procedure with error logging middleware.
 * Use this instead of importing `os` directly.
 */
export const procedure = os.use(async ({ next, path }) => {
	try {
		return await next();
	} catch (error) {
		if (!isValidationError(error)) {
			log.error(`Procedure failed: ${path.join(".")}`, {
				path: path.join("."),
				error: errorToObject(error),
			});
		}
		throw error;
	}
});

/**
 * Procedure that requires the current session to belong to a superadmin.
 * Throws an error if the user is not authenticated or not a superadmin.
 *
 * Usage: `superadminProcedure` instead of `procedure`
 */
export const superadminProcedure = os
	.use(async ({ next, path }) => {
		try {
			return await next();
		} catch (error) {
			if (!isValidationError(error)) {
				log.error(`Procedure failed: ${path.join(".")}`, {
					path: path.join("."),
					error: errorToObject(error),
				});
			}
			throw error;
		}
	})
	.use(async ({ next }) => {
		const headers = getRequestHeaders();
		if (!headers) {
			throw new Error("Authentication required");
		}

		const auth = getAuth();
		const session = await auth.api.getSession({
			headers: headers as unknown as Headers,
		});

		if (!session) {
			throw new Error("Authentication required");
		}

		const db = getDb();
		const [userRecord] = await db
			.select()
			.from(user)
			.where(eq(user.id, session.user.id));

		if (!userRecord) {
			throw new Error("User not found");
		}

		if (userRecord.role !== "superadmin") {
			throw new Error("Superadmin role required");
		}

		// Pass user context to the handler
		return await next({
			context: { session, user: userRecord },
		});
	});

/**
 * Context type added by superadminProcedure middleware
 */
export interface AuthenticatedContext {
	session: {
		user: {
			id: string;
			name: string;
			email: string;
			role: string;
		};
	};
	user: typeof user.$inferSelect;
}
