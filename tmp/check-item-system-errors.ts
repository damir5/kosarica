import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';

async function main() {
  const db = getDb();
  const id = 'rit_1voHUi5MnzXEt9RwpVAsSP3C';
  const rows = await db.execute(sql`
    SELECT item_a_id, item_b_id, system_error, llm_reasoning
    FROM semantic_pair_decisions
    WHERE (item_a_id = ${id} OR item_b_id = ${id})
      AND final_status = 'SYSTEM_ERROR'
    ORDER BY updated_at DESC
    LIMIT 10
  `);
  const out = Array.isArray(rows) ? rows : rows.rows ?? [];
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
