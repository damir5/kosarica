import { isNotNull, sql } from "drizzle-orm";
import { chains, stores } from "../src/db/schema";
import { getDatabase } from "../src/db";

const GOOGLE_PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

interface GooglePlaceResult {
  places: Array<{
    id: string;
    displayName: { text: string };
    location: { latitude: number; longitude: number };
    formattedAddress: string;
    addressComponents: Array<{
      longText: string;
      shortText: string;
      types: string[];
    }>;
  }>;
};

async function searchPlace(query: string): Promise<GooglePlaceResult | null> {
  const response = await fetch(GOOGLE_PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY!,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.formattedAddress,places.addressComponents",
    },
    body: JSON.stringify({
      textQuery: query,
      pageSize: 3,
      locationBias: {
        circle: {
          center: { latitude: 45.1, longitude: 15.2 },
          radius: 50000,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Google Places error: ${response.status} ${text}`);
    return null;
  }

  return response.json();
}

function buildSearchQueries(store: {
  name: string;
  city: string | null;
  address: string | null;
  chainName: string;
}): string[] {
  const queries: string[] = [];
  const { name, city, address, chainName } = store;

  if (city) {
    queries.push(`${chainName} ${city}, Croatia`);
    if (address) {
      queries.push(`${chainName}, ${address}, ${city}, Croatia`);
    }
  }
  if (address && !city) {
    queries.push(`${chainName}, ${address}, Croatia`);
  }
  queries.push(`${name}, Croatia`);

  return [...new Set(queries)];
}

async function main() {
  if (!API_KEY) {
    console.error("GOOGLE_MAPS_API_KEY environment variable is required");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;

  const db = getDatabase();

  const allStores = await db
    .select({
      id: stores.id,
      name: stores.name,
      city: stores.city,
      address: stores.address,
      displayName: stores.displayName,
      chainSlug: stores.chainSlug,
      chainName: chains.name,
    })
    .from(stores)
    .innerJoin(chains, sql`${stores.chainSlug} = ${chains.slug}`)
    .where(isNotNull(stores.city));

  console.log(`Found ${allStores.length} stores with cities`);

  const storesToProcess = limit ? allStores.slice(0, limit) : allStores;
  console.log(`Processing ${storesToProcess.length} stores${limit ? ` (limited from ${allStores.length})` : ""}`);

  const updates: Array<{
    id: string;
    latitude: string;
    longitude: string;
    displayName: string;
    city: string;
  }> = [];

  for (let i = 0; i < storesToProcess.length; i++) {
    const store = storesToProcess[i];
    const queries = buildSearchQueries(store);

    let found = false;
    for (const query of queries) {
      if (found) break;

      console.log(`[${i + 1}/${storesToProcess.length}] Searching: ${query}`);

      try {
        const result = await searchPlace(query);

        if (result?.places?.length) {
          const place = result.places[0];
          const cityComponent = place.addressComponents.find((c) =>
            c.types.includes("locality"),
          );

          updates.push({
            id: store.id,
            latitude: place.location.latitude.toString(),
            longitude: place.location.longitude.toString(),
            displayName: place.displayName?.text || store.displayName || store.name,
            city: cityComponent?.longText || store.city || "",
          });

          console.log(`  ✓ Found: ${place.displayName?.text} (${place.location.latitude}, ${place.location.longitude})`);
          found = true;
        }

        await new Promise((r) => setTimeout(r, 200));
      } catch (error) {
        console.error(`  ✗ Error: ${error}`);
      }
    }

    if (!found) {
      console.log(`  ✗ Not found`);
    }
  }

  console.log(`\nUpdating ${updates.length} stores with new coordinates...`);

  if (dryRun) {
    console.log("DRY RUN - showing first 10 updates:");
    updates.slice(0, 10).forEach((u) => {
      console.log(`  ${u.id}: (${u.latitude}, ${u.longitude}) - ${u.displayName}`);
    });
    console.log("Run without --dry-run to apply changes");
    return;
  }

  const batchSize = 100;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const values = sql.join(
      batch.map(
        (u) =>
          sql`(${u.id}, ${u.latitude}, ${u.longitude}, ${u.displayName}, ${u.city})`,
      ),
      sql`, `,
    );

    await db.execute(sql`
      UPDATE stores AS s
      SET latitude = src.latitude,
          longitude = src.longitude,
          display_name = src.display_name,
          city = src.city,
          updated_at = NOW()
      FROM (VALUES ${values}) AS src(id, latitude, longitude, display_name, city)
      WHERE s.id = src.id
    `);
    console.log(`Updated batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(updates.length / batchSize)}`);
  }

  console.log("Done!");
}

main().catch(console.error);
