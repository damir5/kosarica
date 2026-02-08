import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { clusterMembers } from '@/db/schema';
import { getDb } from '@/utils/bindings';

async function main() {
  const db = getDb();
  const id = 'rit_1voHUi5MnzXEt9RwpVAsSP3C';
  const own = await db.execute(sql`
    SELECT cluster_id
    FROM cluster_members
    WHERE retailer_item_id = ${id}
    LIMIT 1
  `);
  const clusterId = (Array.isArray(own) ? own[0] : own.rows?.[0])?.cluster_id as string | undefined;
  if (!clusterId) {
    console.log(JSON.stringify({ clusterId: null, members: [] }, null, 2));
    return;
  }

  const members = await db
    .select({ retailerItemId: clusterMembers.retailerItemId, isCanonical: clusterMembers.isCanonical })
    .from(clusterMembers)
    .where(eq(clusterMembers.clusterId, clusterId));

  console.log(JSON.stringify({ clusterId, membersCount: members.length, members }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
