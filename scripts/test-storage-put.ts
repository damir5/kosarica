import { config } from "dotenv";
config({ path: ".env.development" });
config();

import { createTestTempDir, deleteTempDir, getStorage } from "@/lib/storage";

async function main() {
    console.log("Testing storage.put...");

    const storage = getStorage();
    console.log("Storage type:", storage.constructor.name);

    // Create a 1.2MB buffer similar to the CSV
    const size = 1267971;
    const data = Buffer.alloc(size, "test,data,row\n");
    console.log("Created buffer of size:", data.length);

    // Use temp directory for test files
    const tempDir = await createTestTempDir("storage-put-test");
    console.log("Created temp directory:", tempDir);

    const key = `${tempDir}/test-file.csv`;
    console.log("Key:", key);

    console.log("Starting storage.put with csv metadata...");
    const start = Date.now();
    await storage.put(key, data, {
        originalName: "test-file.csv",
        chainSlug: "test",
        sourceUrl: "http://test.example.com/test.csv",
        downloadedAt: new Date(),
        custom: {
            file_type: "csv",
        },
    });
    const elapsed = Date.now() - start;
    console.log("storage.put done in", elapsed, "ms");

    // Check it exists
    console.log("Checking exists...");
    const exists = await storage.exists(key);
    console.log("Exists:", exists);

    // Cleanup
    console.log("Cleaning up...");
    await deleteTempDir(tempDir);

    console.log("Done!");
}

main().catch(e => {
    console.error("Error:", e);
    process.exit(1);
});
