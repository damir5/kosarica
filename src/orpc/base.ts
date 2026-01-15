import { os } from "@orpc/server";
import { createLogger, errorToObject } from "@/utils/logger";

const log = createLogger("rpc");

/**
 * Base procedure with error logging middleware.
 * Use this instead of importing `os` directly.
 */
export const procedure = os.use(async ({ next, path }) => {
	try {
		return await next();
	} catch (error) {
		log.error(`Procedure failed: ${path.join(".")}`, {
			path: path.join("."),
			error: errorToObject(error),
		});
		throw error;
	}
});
