import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { retailerItems } from '@/db/schema';
import { getDb } from '@/utils/bindings';

async function main() {
  const db = getDb();
  const id = 'rit_1voHRsYtIyvNQgA99eoJXkkw';
  const row = await db
    .select({ id: retailerItems.id, name: retailerItems.name, brand: retailerItems.brand, chainSlug: retailerItems.chainSlug })
    .from(retailerItems)
    .where(eq(retailerItems.id, id))
    .limit(1);
  console.log(JSON.stringify(row[0] ?? null, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
