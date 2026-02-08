import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '@/utils/bindings';

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: unknown[] }).rows ?? []) as T[];
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
    ORDER BY id ASC
  `);
  const cocaIds = getRows<{ id: string }>(cocaRows).map((row) => row.id);
  const idList = sql`(${sql.join(cocaIds.map((id) => sql`${id}`), sql`, `)})`;

  const pairStatus = await db.execute(sql`
    SELECT final_status, count(*)::int AS c
    FROM semantic_pair_decisions
    WHERE item_a_id IN ${idList} OR item_b_id IN ${idList}
    GROUP BY final_status
    ORDER BY final_status
  `);

  const verdicts = await db.execute(sql`
    SELECT coalesce(final_verdict, 'NULL') AS verdict, count(*)::int AS c
    FROM semantic_pair_decisions
    WHERE (item_a_id IN ${idList} OR item_b_id IN ${idList})
      AND final_status = 'APPROVED'
    GROUP BY coalesce(final_verdict, 'NULL')
    ORDER BY c DESC
  `);

  const connectedItems = await db.execute(sql`
    SELECT count(DISTINCT retailer_item_id)::int AS c
    FROM cluster_members
    WHERE retailer_item_id IN ${idList}
  `);

  const clusterSizes = await db.execute(sql`
    SELECT
      cm.cluster_id,
      count(*)::int AS members,
      max(pc.cluster_type) AS cluster_type,
      max(pc.canonical_name) AS canonical_name
    FROM cluster_members cm
    LEFT JOIN product_clusters pc ON pc.id = cm.cluster_id
    WHERE cm.retailer_item_id IN ${idList}
    GROUP BY cm.cluster_id
    ORDER BY members DESC
    LIMIT 12
  `);

  const unresolvedTop = await db.execute(sql`
    SELECT item_a_id, item_b_id, final_status, system_error
    FROM semantic_pair_decisions
    WHERE (item_a_id IN ${idList} OR item_b_id IN ${idList})
      AND final_status IN ('PENDING_REVIEW','SYSTEM_ERROR')
    ORDER BY updated_at DESC
    LIMIT 12
  `);

  console.log(JSON.stringify({
    cocaItems: cocaIds.length,
    connectedItems: getRows<{ c: number }>(connectedItems)[0]?.c ?? 0,
    pairStatus: getRows(pairStatus),
    approvedVerdicts: getRows(verdicts),
    topClusters: getRows(clusterSizes),
    unresolvedSample: getRows(unresolvedTop),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
