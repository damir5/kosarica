import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';

async function main() {
  const db = getDb();
  const result = await db.execute(sql`SELECT count(*)::int AS c FROM retailer_item_features`);
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  console.log(JSON.stringify(rows[0] ?? { c: 0 }));
}

main().catch((error) => { console.error(error); process.exit(1); });
