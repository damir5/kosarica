import { z } from "zod";

export const serverEnvSchema = z.object({
	BETTER_AUTH_SECRET: z.string().min(32),
	BETTER_AUTH_URL: z.string().url(),
});

export const clientEnvSchema = z.object({
	VITE_APP_TITLE: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;
