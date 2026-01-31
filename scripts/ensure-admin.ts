#!/usr/bin/env tsx
import {account,user} from "@/db/schema";
import {getDb} from "@/utils/bindings";
import {generatePrefixedId} from "@/utils/id";
import {hashPassword} from "better-auth/crypto";
import {eq} from "drizzle-orm";

async function ensureAdmin() {
	const db = getDb();

	// THIS FOR USE IN DEV ONLY AND DONT WORRY ABOUT HARDCODED PASS
	const email = "admin@dev.local";
	const password = "admin123456";

	// Check if user already exists
	const existing = await db.select().from(user).where(eq(user.email, email));
	if (existing.length > 0) {
		// Ensure role is superadmin
		await db
			.update(user)
			.set({ role: "superadmin" })
			.where(eq(user.email, email));
		console.log(`✓ Admin user already exists: ${email}`);
		return;
	}

	// Create user and account directly (handles password hashing with better-auth)
	const userId = generatePrefixedId("usr");
	const accountId = generatePrefixedId("acc");
	const hashedPassword = await hashPassword(password);
	const now = new Date();

	await db.insert(user).values({
		id: userId,
		name: "Dev Admin",
		email,
		emailVerified: false,
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

	console.log(`✓ Admin user created: ${email}`);
	console.log(`  Password: ${password}`);
}

ensureAdmin()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Error:", err);
		process.exit(1);
	});
