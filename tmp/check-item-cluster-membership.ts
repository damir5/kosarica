import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { clusterMembers, productClusters } from '@/db/schema';
import { getDb } from '@/utils/bindings';

async function main() {
  const db = getDb();
  const id = 'rit_1voHUi5MnzXEt9RwpVAsSP3C';

  const rows = await db
    .select({
      clusterId: clusterMembers.clusterId,
      variantClusterId: clusterMembers.variantClusterId,
      clusterType: productClusters.clusterType,
      canonicalName: productClusters.canonicalName,
      isCanonical: clusterMembers.isCanonical,
    })
    .from(clusterMembers)
    .leftJoin(productClusters, eq(productClusters.id, clusterMembers.clusterId))
    .where(eq(clusterMembers.retailerItemId, id));

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
