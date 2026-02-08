import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';

async function main() {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT task_type, status, COUNT(*)::int AS count
    FROM task_queue
    WHERE task_type = 'clickhouse'
    GROUP BY task_type, status
    ORDER BY status
  `);
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
