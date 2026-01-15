import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

export function getEnv(): Env {
	return env;
}

export function getDb() {
	return drizzle(env.DB, { schema });
}
