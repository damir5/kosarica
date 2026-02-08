import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';

async function main() {
  const db = getDb();
  const summary = await db.execute(sql`
    SELECT chain_slug, COUNT(*)::int AS files, COUNT(imported_at)::int AS imported
    FROM parquet_files
    GROUP BY chain_slug
    ORDER BY files DESC
  `);
  const rows = Array.isArray(summary) ? summary : summary.rows ?? [];
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
