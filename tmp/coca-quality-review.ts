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

  const approvedSplit = await db.execute(sql`
    WITH approved AS (
      SELECT item_a_id, item_b_id
      FROM semantic_pair_decisions
      WHERE final_status = 'APPROVED'
        AND (item_a_id IN ${idList} OR item_b_id IN ${idList})
    )
    SELECT
      SUM(CASE WHEN item_a_id IN ${idList} AND item_b_id IN ${idList} THEN 1 ELSE 0 END)::int AS both_coca,
      SUM(CASE WHEN (item_a_id IN ${idList}) <> (item_b_id IN ${idList}) THEN 1 ELSE 0 END)::int AS mixed_coca_non_coca
    FROM approved
  `);

  const contamination = await db.execute(sql`
    WITH coca_clusters AS (
      SELECT DISTINCT cluster_id
      FROM cluster_members
      WHERE retailer_item_id IN ${idList}
    ),
    members AS (
      SELECT
        cm.cluster_id,
        cm.retailer_item_id,
        CASE WHEN cm.retailer_item_id IN ${idList} THEN 1 ELSE 0 END AS is_coca
      FROM cluster_members cm
      JOIN coca_clusters cc ON cc.cluster_id = cm.cluster_id
    )
    SELECT
      count(DISTINCT cluster_id)::int AS clusters_with_coca,
      count(DISTINCT CASE WHEN is_coca = 0 THEN cluster_id END)::int AS clusters_with_non_coca_members,
      count(*)::int AS total_members_in_coca_clusters,
      sum(is_coca)::int AS coca_members,
      sum(CASE WHEN is_coca = 0 THEN 1 ELSE 0 END)::int AS non_coca_members
    FROM members
  `);

  const suspiciousClusters = await db.execute(sql`
    WITH coca_clusters AS (
      SELECT DISTINCT cluster_id
      FROM cluster_members
      WHERE retailer_item_id IN ${idList}
    ),
    ranked AS (
      SELECT
        cm.cluster_id,
        pc.canonical_name,
        SUM(CASE WHEN cm.retailer_item_id IN ${idList} THEN 1 ELSE 0 END)::int AS coca_members,
        SUM(CASE WHEN cm.retailer_item_id IN ${idList} THEN 0 ELSE 1 END)::int AS non_coca_members,
        COUNT(*)::int AS total_members
      FROM cluster_members cm
      LEFT JOIN product_clusters pc ON pc.id = cm.cluster_id
      JOIN coca_clusters cc ON cc.cluster_id = cm.cluster_id
      GROUP BY cm.cluster_id, pc.canonical_name
    )
    SELECT *
    FROM ranked
    WHERE non_coca_members > 0
    ORDER BY non_coca_members DESC, coca_members DESC
    LIMIT 12
  `);

  const out = {
    approvedSplit: getRows(approvedSplit)[0] ?? null,
    contamination: getRows(contamination)[0] ?? null,
    suspiciousClusters: getRows(suspiciousClusters),
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
