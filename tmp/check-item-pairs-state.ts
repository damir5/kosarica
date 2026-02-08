import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';

async function main() {
  const db = getDb();
  const id = 'rit_1voHUi5MnzXEt9RwpVAsSP3C';
  const rows = await db.execute(sql`
    SELECT final_status, count(*)::int AS c
    FROM semantic_pair_decisions
    WHERE item_a_id = ${id} OR item_b_id = ${id}
    GROUP BY final_status
    ORDER BY final_status
  `);
  const sample = await db.execute(sql`
    SELECT item_a_id, item_b_id, final_status, system_error
    FROM semantic_pair_decisions
    WHERE (item_a_id = ${id} OR item_b_id = ${id})
      AND final_status IN ('SYSTEM_ERROR', 'PENDING_REVIEW')
    ORDER BY updated_at DESC
    LIMIT 8
  `);
  const statusRows = Array.isArray(rows) ? rows : rows.rows ?? [];
  const sampleRows = Array.isArray(sample) ? sample : sample.rows ?? [];
  console.log(JSON.stringify({ statusRows, sampleRows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
