import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

function buildInList(values: readonly string[]) {
  return sql`(${sql.join(values.map((value) => sql`${value}`), sql`, `)})`;
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
  const idList = buildInList(cocaIds);

  const statusRows = await db.execute(sql`
    SELECT final_status, count(*)::int AS c
    FROM semantic_pair_decisions
    WHERE item_a_id IN ${idList} OR item_b_id IN ${idList}
    GROUP BY final_status
    ORDER BY final_status
  `);

  const unresolved = await db.execute(sql`
    SELECT count(*)::int AS c
    FROM semantic_pair_decisions
    WHERE final_status IN ('PENDING_REVIEW','SYSTEM_ERROR')
      AND (item_a_id IN ${idList} OR item_b_id IN ${idList})
  `);

  console.log(JSON.stringify({
    cocaItems: cocaIds.length,
    statuses: getRows(statusRows),
    unresolved: getRows<{c:number}>(unresolved)[0]?.c ?? 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
