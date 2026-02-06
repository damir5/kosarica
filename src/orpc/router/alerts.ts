/**
 * Price Alerts Router
 *
 * CRUD endpoints for user price alerts. Auth-gated via authProcedure.
 */

import * as z from "zod";
import { and, desc, eq } from "drizzle-orm";
import { priceAlerts, products } from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { authProcedure, type AuthenticatedContext } from "../base";

// ============================================================================
// List alerts for current user
// ============================================================================

export const listAlerts = authProcedure
	.input(
		z.object({
			status: z
				.enum(["active", "triggered", "disabled"])
				.optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		const { user } = context as AuthenticatedContext;
		const db = getDb();

		const conditions = [eq(priceAlerts.userId, user.id)];
		if (input.status) {
			conditions.push(eq(priceAlerts.status, input.status));
		}

		const alerts = await db
			.select({
				id: priceAlerts.id,
				productId: priceAlerts.productId,
				productName: products.name,
				productCategory: products.category,
				targetPrice: priceAlerts.targetPrice,
				direction: priceAlerts.direction,
				status: priceAlerts.status,
				triggeredAt: priceAlerts.triggeredAt,
				createdAt: priceAlerts.createdAt,
			})
			.from(priceAlerts)
			.innerJoin(products, eq(priceAlerts.productId, products.id))
			.where(and(...conditions))
			.orderBy(desc(priceAlerts.createdAt));

		return { alerts };
	});

// ============================================================================
// Create alert
// ============================================================================

export const createAlert = authProcedure
	.input(
		z.object({
			productId: z.string(),
			targetPrice: z.number().int().min(1),
			direction: z.enum(["below", "above"]),
		}),
	)
	.handler(async ({ input, context }) => {
		const { user } = context as AuthenticatedContext;
		const db = getDb();

		const [alert] = await db
			.insert(priceAlerts)
			.values({
				userId: user.id,
				productId: input.productId,
				targetPrice: input.targetPrice,
				direction: input.direction,
				status: "active",
			})
			.onConflictDoUpdate({
				target: [
					priceAlerts.userId,
					priceAlerts.productId,
					priceAlerts.direction,
				],
				set: {
					targetPrice: input.targetPrice,
					status: "active",
					triggeredAt: null,
				},
			})
			.returning();

		return { alert };
	});

// ============================================================================
// Delete alert
// ============================================================================

export const deleteAlert = authProcedure
	.input(z.object({ alertId: z.string() }))
	.handler(async ({ input, context }) => {
		const { user } = context as AuthenticatedContext;
		const db = getDb();

		const [deleted] = await db
			.delete(priceAlerts)
			.where(
				and(
					eq(priceAlerts.id, input.alertId),
					eq(priceAlerts.userId, user.id),
				),
			)
			.returning({ id: priceAlerts.id });

		if (!deleted) {
			throw new Error("Alert not found");
		}

		return { success: true };
	});

// ============================================================================
// Alert history (triggered alerts)
// ============================================================================

export const alertHistory = authProcedure
	.input(z.object({}))
	.handler(async ({ context }) => {
		const { user } = context as AuthenticatedContext;
		const db = getDb();

		const history = await db
			.select({
				id: priceAlerts.id,
				productId: priceAlerts.productId,
				productName: products.name,
				targetPrice: priceAlerts.targetPrice,
				direction: priceAlerts.direction,
				triggeredAt: priceAlerts.triggeredAt,
			})
			.from(priceAlerts)
			.innerJoin(products, eq(priceAlerts.productId, products.id))
			.where(
				and(
					eq(priceAlerts.userId, user.id),
					eq(priceAlerts.status, "triggered"),
				),
			)
			.orderBy(desc(priceAlerts.triggeredAt));

		return { history };
	});
