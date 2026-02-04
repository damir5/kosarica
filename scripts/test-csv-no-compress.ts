import { config } from "dotenv";
config({ path: ".env.development" });
config();

import { getStorage } from "@/lib/storage";

async function main() {
    console.log("Testing CSV storage without compression...");

    const url = "https://www.konzum.hr/cjenici/download?title=SUPERMARKET%2C%C5%BDITNA+1A+10310+IVANI%C4%86+GRAD%2C0204%2C52881%2C03.02.2026%2C+05-22.CSV";
    console.log("Fetching real CSV...");
    const response = await fetch(url);
    const content = Buffer.from(await response.arrayBuffer());
    console.log("Fetched", content.length, "bytes");

    const storage = getStorage();
    const key = `test-csv/${Date.now()}/test.csv`;

    // Test WITHOUT file_type in custom (so compression won't trigger)
    console.log("Calling storage.put WITHOUT file_type...");
    const start = Date.now();
    await storage.put(key, content, {
        originalName: "test.csv",
        chainSlug: "konzum",
        sourceUrl: url,
        downloadedAt: new Date(),
        // No custom.file_type - compression should be skipped
    });
    console.log("storage.put completed in", Date.now() - start, "ms");

    // Verify
    console.log("Verifying...");
    const exists = await storage.exists(key);
    console.log("Exists:", exists);

    // Cleanup
    await storage.delete(key);

    console.log("Done!");
}

main().catch(e => {
    console.error("Error:", e);
    process.exit(1);
});
