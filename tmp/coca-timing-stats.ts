import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';

type Row = { votes_json: string | null; final_status: string };
type Vote = { modelId?: string; latencyMs?: number };

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

async function main() {
  const db = getDb();

  const cocaRows = await db.execute(sql`
    SELECT id
    FROM retailer_items
    WHERE merged_into_id IS NULL
      AND (
        lower(name) ~ 'coca[ -]?cola'
        OR lower(coalesce(brand, '')) ~ 'coca[ -]?cola'
      )
  `);
  const cocaIds = getRows<{ id: string }>(cocaRows).map((row) => row.id);

  const inList = sql`(${sql.join(cocaIds.map((id) => sql`${id}`), sql`, `)})`;

  const rows = await db.execute(sql`
    SELECT votes_json, final_status
    FROM semantic_pair_decisions
    WHERE item_a_id IN ${inList} OR item_b_id IN ${inList}
  `);

  const parsedRows = getRows<Row>(rows);
  const byModel = new Map<string, number[]>();
  let withVotes = 0;

  for (const row of parsedRows) {
    if (!row.votes_json) continue;
    withVotes += 1;
    try {
      const votes = JSON.parse(row.votes_json) as Vote[];
      for (const vote of votes) {
        if (!vote.modelId || typeof vote.latencyMs !== 'number' || !Number.isFinite(vote.latencyMs)) continue;
        const arr = byModel.get(vote.modelId) ?? [];
        arr.push(vote.latencyMs);
        byModel.set(vote.modelId, arr);
      }
    } catch {
      // ignore malformed
    }
  }

  const stats = Array.from(byModel.entries()).map(([modelId, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    return {
      modelId,
      count: sorted.length,
      minMs: sorted[0],
      p50Ms: percentile(sorted, 50),
      p90Ms: percentile(sorted, 90),
      p95Ms: percentile(sorted, 95),
      maxMs: sorted[sorted.length - 1],
      avgMs: Math.round(avg),
    };
  }).sort((a, b) => a.modelId.localeCompare(b.modelId));

  console.log(JSON.stringify({
    cocaItems: cocaIds.length,
    pairRowsWithVotes: withVotes,
    modelLatency: stats,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
