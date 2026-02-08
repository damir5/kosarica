import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';

type Row = {
  votes_json: string | null;
  final_status: string;
  updated_at: string;
};

type Vote = {
  modelId?: string;
  latencyMs?: number;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

async function main() {
  const db = getDb();
  const id = 'rit_1voHUi5MnzXEt9RwpVAsSP3C';
  const result = await db.execute(sql`
    SELECT votes_json, final_status, updated_at
    FROM semantic_pair_decisions
    WHERE item_a_id = ${id} OR item_b_id = ${id}
    ORDER BY updated_at DESC
  `);

  const rows = (Array.isArray(result) ? result : result.rows ?? []) as Row[];

  const latencies: number[] = [];
  for (const row of rows) {
    if (!row.votes_json) continue;
    try {
      const parsed = JSON.parse(row.votes_json) as Vote[];
      for (const vote of parsed) {
        if (vote.modelId === 'zai-primary' && typeof vote.latencyMs === 'number' && Number.isFinite(vote.latencyMs)) {
          latencies.push(vote.latencyMs);
        }
      }
    } catch {
      // ignore malformed rows
    }
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const count = sorted.length;
  const avg = count > 0 ? sorted.reduce((sum, n) => sum + n, 0) / count : 0;

  console.log(
    JSON.stringify(
      {
        sampleCount: count,
        minMs: count ? sorted[0] : null,
        p50Ms: count ? percentile(sorted, 50) : null,
        p90Ms: count ? percentile(sorted, 90) : null,
        p95Ms: count ? percentile(sorted, 95) : null,
        maxMs: count ? sorted[count - 1] : null,
        avgMs: count ? Math.round(avg) : null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
