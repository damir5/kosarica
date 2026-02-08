import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';

type Row = { votes_json: string | null };
type Vote = { modelId?: string; latencyMs?: number };

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

async function main() {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT votes_json
    FROM semantic_pair_decisions
    WHERE votes_json IS NOT NULL
  `);

  const rows = (Array.isArray(result) ? result : result.rows ?? []) as Row[];
  const byModel = new Map<string, number[]>();

  for (const row of rows) {
    if (!row.votes_json) continue;
    try {
      const votes = JSON.parse(row.votes_json) as Vote[];
      for (const vote of votes) {
        if (!vote.modelId || typeof vote.latencyMs !== 'number' || !Number.isFinite(vote.latencyMs)) continue;
        const arr = byModel.get(vote.modelId) ?? [];
        arr.push(vote.latencyMs);
        byModel.set(vote.modelId, arr);
      }
    } catch {
      // ignore
    }
  }

  const output = Array.from(byModel.entries())
    .map(([modelId, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const avg = sorted.reduce((s, n) => s + n, 0) / sorted.length;
      return {
        modelId,
        count: sorted.length,
        p50Ms: percentile(sorted, 50),
        p90Ms: percentile(sorted, 90),
        p95Ms: percentile(sorted, 95),
        avgMs: Math.round(avg),
      };
    })
    .sort((a, b) => a.modelId.localeCompare(b.modelId));

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
