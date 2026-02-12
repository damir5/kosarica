#!/usr/bin/env tsx
/**
 * Provision a service account (API key) for programmatic access to oRPC endpoints.
 *
 * Creates a superadmin user `agent@kosarica.local` if it doesn't exist,
 * then generates a Better Auth API key linked to that user.
 *
 * The full key is printed ONCE — store it securely (e.g. `.kamal/secrets`).
 *
 * Usage:
 *   npx tsx scripts/create-service-account.ts
 *   npx tsx scripts/create-service-account.ts --name my-key
 */
import { eq } from "drizzle-orm";
import { account, user } from "@/db/schema";
import { createAuth } from "@/lib/auth";
import { getDb } from "@/utils/bindings";
import { generatePrefixedId } from "@/utils/id";
import { hashPassword } from "better-auth/crypto";

const SERVICE_EMAIL = "agent@kosarica.local";
const SERVICE_NAME = "Service Agent";
const DEFAULT_KEY_NAME = "claude-agent";
const KEY_PREFIX = "kos";

async function main() {
	const keyName = process.argv.includes("--name")
		? process.argv[process.argv.indexOf("--name") + 1] || DEFAULT_KEY_NAME
		: DEFAULT_KEY_NAME;

	const db = getDb();

	// Find or create the service account user
	const [existing] = await db
		.select()
		.from(user)
		.where(eq(user.email, SERVICE_EMAIL));

	let userId: string;

	if (existing) {
		userId = existing.id;
		// Ensure superadmin role
		if (existing.role !== "superadmin") {
			await db
				.update(user)
				.set({ role: "superadmin", updatedAt: new Date() })
				.where(eq(user.id, userId));
		}
		console.log(`Using existing service user: ${SERVICE_EMAIL} (${userId})`);
	} else {
		userId = generatePrefixedId("usr");
		const accountId = generatePrefixedId("acc");
		const now = new Date();
		// Random password — this account is only used via API key, never via password login
		const randomPass = crypto.randomUUID();
		const hashedPassword = await hashPassword(randomPass);

		await db.insert(user).values({
			id: userId,
			name: SERVICE_NAME,
			email: SERVICE_EMAIL,
			emailVerified: true,
			role: "superadmin",
			banned: false,
			createdAt: now,
			updatedAt: now,
		});

		await db.insert(account).values({
			id: accountId,
			accountId: userId,
			providerId: "credential",
			userId,
			password: hashedPassword,
			createdAt: now,
			updatedAt: now,
		});

		console.log(`Created service user: ${SERVICE_EMAIL} (${userId})`);
	}

	// Create API key via Better Auth server-side API
	const auth = createAuth();
	const result = await auth.api.createApiKey({
		body: {
			name: keyName,
			prefix: KEY_PREFIX,
			userId,
		},
	});

	if (!result?.key) {
		console.error("Failed to create API key — no key returned");
		process.exit(1);
	}

	console.log("\n=== API Key Created ===");
	console.log(`Name:   ${keyName}`);
	console.log(`Key:    ${result.key}`);
	console.log("\nSave this key securely. It cannot be retrieved after this.");
	console.log("Add to .kamal/secrets as: SERVICE_ACCOUNT_API_KEY=<key>");
	console.log("\nUsage:");
	console.log(
		'  curl -H "x-api-key: <key>" https://kosarica.duckdns.org/api/rpc/admin/cron/list',
	);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Error:", err);
		process.exit(1);
	});
