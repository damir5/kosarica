/**
 * Price Alerts Router
 *
 * CRUD endpoints for user price alerts. Auth-gated via authProcedure.
 */

import { and, eq, sql } from "drizzle-orm";
import * as z from "zod";
import { priceAlerts } from "@/db/schema";
import { getDb } from "@/utils/bindings";
import { authProcedure, type AuthenticatedContext } from "../base";

const CreateAlertInputSchema = z
	.object({
		variantClusterId: z.string().optional(),
		baseClusterId: z.string().optional(),
		alertScope: z.enum(["variant", "base"]).optional(),
		targetPrice: z.number().int().min(1),
		direction: z.enum(["below", "above"]),
	})
	.refine((input) => Boolean(input.variantClusterId || input.baseClusterId), {
		message: "One of variantClusterId or baseClusterId is required.",
	});

function resolveScope(
	input: z.infer<typeof CreateAlertInputSchema>,
): "variant" | "base" {
	if (input.alertScope) {
		return input.alertScope;
	}
	return input.baseClusterId ? "base" : "variant";
}

// ============================================================================
// List alerts for current user
// ============================================================================

export const listAlerts = authProcedure
	.input(
		z.object({
			status: z.enum(["active", "triggered", "disabled"]).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		const { user } = context as AuthenticatedContext;
		const db = getDb();

		const statusFilter = input.status
			? sql`AND pa.status = ${input.status}`
			: sql``;

		const result = await db.execute(sql`
			SELECT
				pa.id,
				pa.variant_cluster_id,
				pa.base_cluster_id,
				pa.alert_scope,
				COALESCE(pvc.canonical_name, pbc.canonical_name) AS display_name,
				pa.target_price,
				pa.direction,
				pa.status,
				pa.triggered_at,
				pa.created_at
			FROM price_alerts pa
			LEFT JOIN product_clusters pvc ON pvc.id = pa.variant_cluster_id
			LEFT JOIN product_clusters pbc ON pbc.id = pa.base_cluster_id
			WHERE pa.user_id = ${user.id}
			${statusFilter}
			ORDER BY pa.created_at DESC
		`);

		const alerts = ((result as { rows?: unknown[] }).rows ?? []) as Array<{
			id: string;
			variant_cluster_id: string | null;
			base_cluster_id: string | null;
			alert_scope: "variant" | "base";
			display_name: string | null;
			target_price: number;
			direction: "below" | "above";
			status: "active" | "triggered" | "disabled";
			triggered_at: Date | null;
			created_at: Date;
		}>;

		return {
			alerts: alerts.map((alert) => ({
				id: alert.id,
				variantClusterId: alert.variant_cluster_id,
				baseClusterId: alert.base_cluster_id,
				alertScope: alert.alert_scope,
				productName: alert.display_name,
				targetPrice: alert.target_price,
				direction: alert.direction,
				status: alert.status,
				triggeredAt: alert.triggered_at,
				createdAt: alert.created_at,
			})),
		};
	});

// ============================================================================
// Create alert
// ============================================================================

export const createAlert = authProcedure
	.input(CreateAlertInputSchema)
	.handler(async ({ input, context }) => {
		const { user } = context as AuthenticatedContext;
		const db = getDb();
		const alertScope = resolveScope(input);

		if (alertScope === "variant") {
			if (!input.variantClusterId) {
				throw new Error("variantClusterId is required for variant scoped alerts");
			}
			const [alert] = await db
				.insert(priceAlerts)
				.values({
					userId: user.id,
					variantClusterId: input.variantClusterId,
					baseClusterId: null,
					alertScope,
					targetPrice: input.targetPrice,
					direction: input.direction,
					status: "active",
				})
				.onConflictDoUpdate({
					target: [
						priceAlerts.userId,
						priceAlerts.variantClusterId,
						priceAlerts.direction,
					],
					set: {
						targetPrice: input.targetPrice,
						status: "active",
						triggeredAt: null,
						alertScope,
					},
				})
				.returning();
			return { alert };
		}

		if (!input.baseClusterId) {
			throw new Error("baseClusterId is required for base scoped alerts");
		}

		const [alert] = await db
			.insert(priceAlerts)
			.values({
				userId: user.id,
				variantClusterId: null,
				baseClusterId: input.baseClusterId,
				alertScope,
				targetPrice: input.targetPrice,
				direction: input.direction,
				status: "active",
			})
			.onConflictDoUpdate({
				target: [
					priceAlerts.userId,
					priceAlerts.baseClusterId,
					priceAlerts.direction,
				],
				set: {
					targetPrice: input.targetPrice,
					status: "active",
					triggeredAt: null,
					alertScope,
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
			.where(and(eq(priceAlerts.id, input.alertId), eq(priceAlerts.userId, user.id)))
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

		const result = await db.execute(sql`
			SELECT
				pa.id,
				pa.variant_cluster_id,
				pa.base_cluster_id,
				pa.alert_scope,
				COALESCE(pvc.canonical_name, pbc.canonical_name) AS display_name,
				pa.target_price,
				pa.direction,
				pa.triggered_at
			FROM price_alerts pa
			LEFT JOIN product_clusters pvc ON pvc.id = pa.variant_cluster_id
			LEFT JOIN product_clusters pbc ON pbc.id = pa.base_cluster_id
			WHERE pa.user_id = ${user.id}
				AND pa.status = 'triggered'
			ORDER BY pa.triggered_at DESC
		`);

		const history = ((result as { rows?: unknown[] }).rows ?? []) as Array<{
			id: string;
			variant_cluster_id: string | null;
			base_cluster_id: string | null;
			alert_scope: "variant" | "base";
			display_name: string | null;
			target_price: number;
			direction: "below" | "above";
			triggered_at: Date | null;
		}>;

		return {
			history: history.map((entry) => ({
				id: entry.id,
				variantClusterId: entry.variant_cluster_id,
				baseClusterId: entry.base_cluster_id,
				alertScope: entry.alert_scope,
				productName: entry.display_name,
				targetPrice: entry.target_price,
				direction: entry.direction,
				triggeredAt: entry.triggered_at,
			})),
		};
	});
