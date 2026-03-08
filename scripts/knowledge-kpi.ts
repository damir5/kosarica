import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import YAML from "yaml";
import { getDatabase } from "@/db";
import { createLogger } from "@/utils/logger";

const log = createLogger("matching");

const KNOWLEDGE_DIR = resolve(process.cwd(), "knowledge");
const OPS_DIR = join(KNOWLEDGE_DIR, "ops");
const REPORTS_DIR = join(KNOWLEDGE_DIR, "reports");

interface KpiThresholds {
	unlinked_items_max: number;
	pending_product_review_max: number;
	pending_product_review_oldest_hours_max: number;
	candidate_equivalences_max: number;
	stores_needs_review_max: number;
	stores_ungeocoded_active_max: number;
	loop_shards_missing_max: number;
}

interface LoopStateFile {
	_meta: {
		version: string;
		updated_at: string;
		updated_by: string;
		description: string;
	};
	state: {
		shard_count: number;
		global_loop_number: number;
		next_shard: number;
		completed_shards: number[];
		active_agents: Array<{ agent_id: string; shard: number; heartbeat_at: string }>;
		last_full_sweep_completed_at: string | null;
	};
}

interface CandidateEquivalencesFile {
	equivalences?: unknown[];
}

interface AlertEntry {
	at: string;
	severity: "warning" | "critical";
	metric: string;
	value: number;
	threshold: number;
	message: string;
}

interface Dashboard {
	generated_at: string;
	loop_state: {
		shard_count: number;
		completed_shards: number;
		missing_shards: number;
		global_loop_number: number;
		next_shard: number;
		active_agents: number;
		last_full_sweep_completed_at: string | null;
	};
	metrics: {
		unlinked_items: number;
		pending_product_review: number;
		pending_product_review_oldest_hours: number;
		candidate_equivalences: number;
		stores_needs_review: number;
		stores_ungeocoded_active: number;
	};
	alerts: AlertEntry[];
}

async function main() {
	loadRuntimeEnv();

	const failOnAlert = process.argv.includes("--fail-on-alert");
	const thresholds = await readThresholds();
	const loopState = await readLoopState();
	const dashboard = await collectDashboard(thresholds, loopState);

	await writeDashboard(dashboard);
	await appendAlertHistory(dashboard.alerts);

	console.log("Knowledge KPI snapshot written:");
	console.log(`- Alerts: ${dashboard.alerts.length}`);
	console.log(`- Unlinked items: ${dashboard.metrics.unlinked_items}`);
	console.log(
		`- Pending product review: ${dashboard.metrics.pending_product_review} (oldest ${dashboard.metrics.pending_product_review_oldest_hours.toFixed(1)}h)`,
	);
	console.log(`- Candidate equivalences: ${dashboard.metrics.candidate_equivalences}`);
	console.log(`- Stores needs review: ${dashboard.metrics.stores_needs_review}`);
	console.log(
		`- Active stores missing geocode: ${dashboard.metrics.stores_ungeocoded_active}`,
	);
	console.log(
		`- Sweep coverage: ${dashboard.loop_state.completed_shards}/${dashboard.loop_state.shard_count}`,
	);

	for (const alert of dashboard.alerts) {
		console.log(
			`[${alert.severity.toUpperCase()}] ${alert.metric}: ${alert.value} > ${alert.threshold} (${alert.message})`,
		);
	}

	if (dashboard.alerts.length > 0) {
		log.warn("Knowledge KPI alerts generated", {
			alerts: dashboard.alerts.length,
		});
	}

	if (failOnAlert && dashboard.alerts.length > 0) {
		process.exit(1);
	}
}

async function collectDashboard(
	thresholds: KpiThresholds,
	loopStateFile: LoopStateFile,
): Promise<Dashboard> {
	const db = getDatabase();

	const [
		unlinkedItems,
		pendingProductReview,
		pendingProductReviewOldestHours,
		storesNeedsReview,
		storesUngeocodedActive,
		candidateEquivalences,
	] = await Promise.all([
		countQuery(db, sql`
			SELECT COUNT(*)::int AS count
			FROM retailer_items ri
			WHERE ri.merged_into_id IS NULL
			AND NOT EXISTS (
				SELECT 1 FROM sku_item_links sil WHERE sil.retailer_item_id = ri.id
			)
		`),
		countQuery(db, sql`
			SELECT COUNT(*)::int AS count
			FROM semantic_pair_decisions spd
			WHERE spd.final_status IN ('PENDING_REVIEW', 'SYSTEM_ERROR')
		`),
		numericQuery(db, sql`
			SELECT COALESCE(
				EXTRACT(EPOCH FROM (NOW() - MIN(spd.created_at))) / 3600,
				0
			)::float8 AS value
			FROM semantic_pair_decisions spd
			WHERE spd.final_status IN ('PENDING_REVIEW', 'SYSTEM_ERROR')
		`),
		countQuery(db, sql`
			SELECT COUNT(*)::int AS count
			FROM stores s
			WHERE s.status IN ('pending', 'needs_review')
		`),
		countQuery(db, sql`
			SELECT COUNT(*)::int AS count
			FROM stores s
			WHERE s.status = 'active'
			AND (s.latitude IS NULL OR s.longitude IS NULL)
		`),
		countCandidateEquivalences(),
	]);

	const shardCount = Math.max(1, loopStateFile.state.shard_count);
	const completedShards = new Set(loopStateFile.state.completed_shards).size;
	const missingShards = Math.max(0, shardCount - completedShards);

	const alerts = evaluateAlerts(
		{
			unlinked_items: unlinkedItems,
			pending_product_review: pendingProductReview,
			pending_product_review_oldest_hours: pendingProductReviewOldestHours,
			candidate_equivalences: candidateEquivalences,
			stores_needs_review: storesNeedsReview,
			stores_ungeocoded_active: storesUngeocodedActive,
			loop_shards_missing: missingShards,
		},
		thresholds,
	);

	return {
		generated_at: new Date().toISOString(),
		loop_state: {
			shard_count: shardCount,
			completed_shards: completedShards,
			missing_shards: missingShards,
			global_loop_number: loopStateFile.state.global_loop_number,
			next_shard: loopStateFile.state.next_shard,
			active_agents: loopStateFile.state.active_agents.length,
			last_full_sweep_completed_at: loopStateFile.state.last_full_sweep_completed_at,
		},
		metrics: {
			unlinked_items: unlinkedItems,
			pending_product_review: pendingProductReview,
			pending_product_review_oldest_hours: pendingProductReviewOldestHours,
			candidate_equivalences: candidateEquivalences,
			stores_needs_review: storesNeedsReview,
			stores_ungeocoded_active: storesUngeocodedActive,
		},
		alerts,
	};
}

function evaluateAlerts(
	metrics: {
		unlinked_items: number;
		pending_product_review: number;
		pending_product_review_oldest_hours: number;
		candidate_equivalences: number;
		stores_needs_review: number;
		stores_ungeocoded_active: number;
		loop_shards_missing: number;
	},
	thresholds: KpiThresholds,
): AlertEntry[] {
	const now = new Date().toISOString();
	const alerts: AlertEntry[] = [];

	pushIfExceeded(
		alerts,
		now,
		"unlinked_items",
		metrics.unlinked_items,
		thresholds.unlinked_items_max,
		"Unlinked items backlog is above threshold",
	);
	pushIfExceeded(
		alerts,
		now,
		"pending_product_review",
		metrics.pending_product_review,
		thresholds.pending_product_review_max,
		"Pending product review queue is above threshold",
	);
	pushIfExceeded(
		alerts,
		now,
		"pending_product_review_oldest_hours",
		metrics.pending_product_review_oldest_hours,
		thresholds.pending_product_review_oldest_hours_max,
		"Oldest pending product review is too old",
	);
	pushIfExceeded(
		alerts,
		now,
		"candidate_equivalences",
		metrics.candidate_equivalences,
		thresholds.candidate_equivalences_max,
		"Candidate equivalence backlog is above threshold",
	);
	pushIfExceeded(
		alerts,
		now,
		"stores_needs_review",
		metrics.stores_needs_review,
		thresholds.stores_needs_review_max,
		"Store review backlog is above threshold",
	);
	pushIfExceeded(
		alerts,
		now,
		"stores_ungeocoded_active",
		metrics.stores_ungeocoded_active,
		thresholds.stores_ungeocoded_active_max,
		"Active stores missing geocode are above threshold",
	);
	pushIfExceeded(
		alerts,
		now,
		"loop_shards_missing",
		metrics.loop_shards_missing,
		thresholds.loop_shards_missing_max,
		"Loop sweep coverage is lagging",
	);

	return alerts;
}

function pushIfExceeded(
	alerts: AlertEntry[],
	at: string,
	metric: string,
	value: number,
	threshold: number,
	message: string,
): void {
	if (value <= threshold) {
		return;
	}
	alerts.push({
		at,
		severity: value > threshold * 1.5 ? "critical" : "warning",
		metric,
		value,
		threshold,
		message,
	});
}

async function countQuery(db: ReturnType<typeof getDatabase>, query: unknown): Promise<number> {
	const result = await db.execute(query as Parameters<typeof db.execute>[0]);
	const rows = (
		Array.isArray(result)
			? result
			: ((result as { rows?: unknown[] }).rows ?? [])
	) as Array<{ count?: number | string }>;
	const raw = rows[0]?.count;
	if (typeof raw === "number") return raw;
	if (typeof raw === "string") return Number.parseInt(raw, 10) || 0;
	return 0;
}

async function numericQuery(
	db: ReturnType<typeof getDatabase>,
	query: unknown,
): Promise<number> {
	const result = await db.execute(query as Parameters<typeof db.execute>[0]);
	const rows = (
		Array.isArray(result)
			? result
			: ((result as { rows?: unknown[] }).rows ?? [])
	) as Array<{ value?: number | string }>;
	const raw = rows[0]?.value;
	if (typeof raw === "number") return raw;
	if (typeof raw === "string") return Number.parseFloat(raw) || 0;
	return 0;
}

async function countCandidateEquivalences(): Promise<number> {
	const file = join(KNOWLEDGE_DIR, "equivalences", "_candidates.yaml");
	const parsed = (await readYaml(file)) as CandidateEquivalencesFile;
	return Array.isArray(parsed.equivalences) ? parsed.equivalences.length : 0;
}

async function readThresholds(): Promise<KpiThresholds> {
	const file = join(OPS_DIR, "kpi-thresholds.yaml");
	const parsed = (await readYaml(file)) as { thresholds?: Partial<KpiThresholds> };
	return {
		unlinked_items_max: parsed.thresholds?.unlinked_items_max ?? 5000,
		pending_product_review_max: parsed.thresholds?.pending_product_review_max ?? 1000,
		pending_product_review_oldest_hours_max:
			parsed.thresholds?.pending_product_review_oldest_hours_max ?? 72,
		candidate_equivalences_max: parsed.thresholds?.candidate_equivalences_max ?? 2000,
		stores_needs_review_max: parsed.thresholds?.stores_needs_review_max ?? 200,
		stores_ungeocoded_active_max:
			parsed.thresholds?.stores_ungeocoded_active_max ?? 100,
		loop_shards_missing_max: parsed.thresholds?.loop_shards_missing_max ?? 16,
	};
}

async function readLoopState(): Promise<LoopStateFile> {
	const file = join(OPS_DIR, "loop-state.yaml");
	const parsed = (await readYaml(file)) as LoopStateFile;
	return parsed;
}

async function writeDashboard(dashboard: Dashboard): Promise<void> {
	const now = new Date();
	const datePart = now.toISOString().slice(0, 10);
	const timePart = now.toISOString().slice(11, 19).replace(/:/g, "");
	const reportDir = join(REPORTS_DIR, datePart);
	await mkdir(reportDir, { recursive: true });

	const reportPath = join(reportDir, `kpi-${timePart}.yaml`);
	const latestYamlPath = join(OPS_DIR, "dashboard-latest.yaml");
	const latestMdPath = join(OPS_DIR, "dashboard-latest.md");

	const yaml = YAML.stringify(dashboard);
	await writeFile(reportPath, yaml, "utf8");
	await writeFile(latestYamlPath, yaml, "utf8");
	await writeFile(latestMdPath, renderDashboardMarkdown(dashboard), "utf8");
}

async function appendAlertHistory(alerts: AlertEntry[]): Promise<void> {
	if (alerts.length === 0) {
		return;
	}

	const file = join(OPS_DIR, "alerts-history.yaml");
	const parsed = (await readYaml(file)) as {
		_meta?: Record<string, unknown>;
		entries?: AlertEntry[];
	};
	const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
	const next = {
		_meta: {
			version: "1.0",
			updated_at: new Date().toISOString(),
			updated_by: "knowledge-kpi-script",
			description: "Append-only alert history from knowledge KPI runs",
		},
		entries: [...entries, ...alerts],
	};
	await writeFile(file, YAML.stringify(next), "utf8");
}

async function readYaml(path: string): Promise<unknown> {
	const content = await readFile(path, "utf8");
	return YAML.parse(content) as unknown;
}

function renderDashboardMarkdown(dashboard: Dashboard): string {
	const lines: string[] = [];
	lines.push("# Knowledge KPI Dashboard");
	lines.push("");
	lines.push(`Generated at: ${dashboard.generated_at}`);
	lines.push("");
	lines.push("## Loop Coverage");
	lines.push("");
	lines.push(`- Shard count: ${dashboard.loop_state.shard_count}`);
	lines.push(
		`- Completed shards: ${dashboard.loop_state.completed_shards} (missing ${dashboard.loop_state.missing_shards})`,
	);
	lines.push(`- Global loop number: ${dashboard.loop_state.global_loop_number}`);
	lines.push(`- Next shard: ${dashboard.loop_state.next_shard}`);
	lines.push(`- Active agents: ${dashboard.loop_state.active_agents}`);
	lines.push(
		`- Last full sweep: ${dashboard.loop_state.last_full_sweep_completed_at ?? "n/a"}`,
	);
	lines.push("");
	lines.push("## Metrics");
	lines.push("");
	lines.push(`- Unlinked items: ${dashboard.metrics.unlinked_items}`);
	lines.push(`- Pending product review: ${dashboard.metrics.pending_product_review}`);
	lines.push(
		`- Oldest pending product review (hours): ${dashboard.metrics.pending_product_review_oldest_hours.toFixed(1)}`,
	);
	lines.push(
		`- Candidate equivalences: ${dashboard.metrics.candidate_equivalences}`,
	);
	lines.push(`- Stores needs review: ${dashboard.metrics.stores_needs_review}`);
	lines.push(
		`- Active stores missing geocode: ${dashboard.metrics.stores_ungeocoded_active}`,
	);
	lines.push("");
	lines.push("## Alerts");
	lines.push("");
	if (dashboard.alerts.length === 0) {
		lines.push("- None");
	} else {
		for (const alert of dashboard.alerts) {
			lines.push(
				`- [${alert.severity.toUpperCase()}] ${alert.metric}: ${alert.value} > ${alert.threshold} (${alert.message})`,
			);
		}
	}
	return lines.join("\n");
}

function loadRuntimeEnv(): void {
	if (process.env.DATABASE_URL) {
		return;
	}

	const envCandidates: string[] = [];
	if (process.env.NODE_ENV) {
		envCandidates.push(`.env.${process.env.NODE_ENV}`);
	}
	envCandidates.push(".env.test", ".env.development", ".env");

	for (const file of envCandidates) {
		if (!existsSync(file)) {
			continue;
		}
		loadDotenv({ path: file });
		if (process.env.DATABASE_URL) {
			return;
		}
	}
}

main().catch((error) => {
	log.error("Knowledge KPI run failed", { error });
	process.exit(1);
});
