import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { clusterMembers, productClusters, retailerItems } from '@/db/schema';
import { getClickHouse } from '@/lib/clickhouse';
import { getDb } from '@/utils/bindings';

async function main() {
  const id = 'rit_1voHUi5MnzXEt9RwpVAsSP3C';
  const db = getDb();
  const ch = getClickHouse();

  const [item] = await db
    .select({
      id: retailerItems.id,
      name: retailerItems.name,
      chainSlug: retailerItems.chainSlug,
      category: retailerItems.category,
    })
    .from(retailerItems)
    .where(eq(retailerItems.id, id))
    .limit(1);

  const [clusterMembership] = await db
    .select({
      clusterId: clusterMembers.clusterId,
      variantClusterId: clusterMembers.variantClusterId,
    })
    .from(clusterMembers)
    .where(eq(clusterMembers.retailerItemId, id))
    .limit(1);

  const [cluster] = clusterMembership
    ? await db
        .select({
          id: productClusters.id,
          clusterType: productClusters.clusterType,
          canonicalName: productClusters.canonicalName,
        })
        .from(productClusters)
        .where(eq(productClusters.id, clusterMembership.clusterId))
        .limit(1)
    : [];

  let relatedIds: string[] = [id];

  if (cluster) {
    if (cluster.clusterType === 'variant') {
      const members = await db
        .select({ retailerItemId: clusterMembers.retailerItemId })
        .from(clusterMembers)
        .where(eq(clusterMembers.clusterId, cluster.id));

      relatedIds = members
        .map((member) => member.retailerItemId)
        .filter((value): value is string => value != null);
    } else {
      const baseMembers = await db
        .select({ variantClusterId: clusterMembers.variantClusterId })
        .from(clusterMembers)
        .where(eq(clusterMembers.clusterId, cluster.id));

      const variantIds = baseMembers
        .map((member) => member.variantClusterId)
        .filter((value): value is string => value != null);

      if (variantIds.length > 0) {
        const variantItems = await db
          .select({ retailerItemId: clusterMembers.retailerItemId })
          .from(clusterMembers)
          .where(inArray(clusterMembers.clusterId, variantIds));

        relatedIds = variantItems
          .map((member) => member.retailerItemId)
          .filter((value): value is string => value != null);
      } else {
        relatedIds = [];
      }
    }
  }

  const rowCount = await ch.query<{ c: number | string }>(
    `SELECT count() AS c
     FROM prices
     WHERE retailer_item_id IN ({ids:Array(String)})
       AND target_date <= today()`,
    { ids: relatedIds },
  );

  const latestRows = await ch.query<{
    retailer_item_id: string;
    chain_slug: string;
    store_id: string;
    last_seen: string;
  }>(
    `SELECT
        retailer_item_id,
        chain_slug,
        store_id,
        toString(max(target_date)) AS last_seen
     FROM prices
     WHERE retailer_item_id IN ({ids:Array(String)})
       AND target_date <= today()
     GROUP BY retailer_item_id, chain_slug, store_id
     ORDER BY last_seen DESC
     LIMIT 10`,
    { ids: relatedIds },
  );

  console.log(
    JSON.stringify(
      {
        id,
        item: item ?? null,
        clusterMembership: clusterMembership ?? null,
        cluster: cluster ?? null,
        relatedCount: relatedIds.length,
        relatedSample: relatedIds.slice(0, 10),
        clickhousePriceRows: Number(rowCount[0]?.c ?? 0),
        clickhouseLatestRows: latestRows,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
