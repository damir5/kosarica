import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';

async function main() {
  const db = getDb();
  const id = 'rit_1voHUi5MnzXEt9RwpVAsSP3C';
  const total = await db.execute(sql`SELECT count(*)::int AS c FROM semantic_pair_decisions`);
  const pending = await db.execute(sql`SELECT count(*)::int AS c FROM semantic_pair_decisions WHERE final_status='PENDING_REVIEW' AND llm_verdict IS NULL`);
  const item = await db.execute(sql`SELECT count(*)::int AS c FROM semantic_pair_decisions WHERE item_a_id=${id} OR item_b_id=${id}`);
  const itemPending = await db.execute(sql`SELECT count(*)::int AS c FROM semantic_pair_decisions WHERE (item_a_id=${id} OR item_b_id=${id}) AND final_status='PENDING_REVIEW' AND llm_verdict IS NULL`);
  const rows = (r: unknown): Array<{ c: number }> => (Array.isArray(r) ? (r as Array<{ c: number }>) : (((r as { rows?: Array<{ c: number }> }).rows) ?? []));
  console.log(JSON.stringify({ total: rows(total)[0]?.c ?? 0, pending: rows(pending)[0]?.c ?? 0, itemPairs: rows(item)[0]?.c ?? 0, itemPending: rows(itemPending)[0]?.c ?? 0 }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
