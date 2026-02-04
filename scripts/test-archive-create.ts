import { config } from "dotenv";
config({ path: ".env.development" });
config();

import { getDatabase } from "@/db";
import { archives } from "@/db/schema";
import { getStorage, buildArchiveKey } from "@/lib/storage";
import { generatePrefixedId } from "@/utils/id";

async function main() {
    console.log("Testing archive creation...");

    const storage = getStorage();
    const chainSlug = "konzum";
    const filename = "test-file.csv";
    const content = Buffer.from("test,data\n1,2\n3,4");
    const targetDate = new Date("2026-02-03");

    const archiveKey = buildArchiveKey(chainSlug, targetDate, filename);
    console.log("Archive key:", archiveKey);

    console.log("1. Putting to storage...");
    await storage.put(archiveKey, content, {
        originalName: filename,
        chainSlug,
        sourceUrl: "http://test.example.com/test.csv",
        downloadedAt: new Date(),
    });
    console.log("   Done");

    console.log("2. Getting storage info...");
    const info = await storage.getInfo(archiveKey);
    console.log("   Info:", JSON.stringify(info, null, 2));

    console.log("3. Inserting to database...");
    const archiveId = generatePrefixedId("arc");
    const db = getDatabase();

    await db.insert(archives).values({
        id: archiveId,
        chainSlug,
        sourceUrl: "http://test.example.com/test.csv",
        filename,
        originalFormat: "csv",
        archivePath: archiveKey,
        archiveType: "local",
        contentType: info.metadata?.contentType,
        fileSize: content.length,
        compressedSize: null,
        isCompressed: false,
        checksum: info.checksum,
        downloadedAt: new Date(),
        metadata: {
            originalFilename: filename,
            fileType: "csv",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        runId: null,
    });
    console.log("   Done, archiveId:", archiveId);

    // Cleanup
    await storage.delete(archiveKey);
    await db.delete(archives).where(archives.id === archiveId);

    console.log("All done!");
}

main().catch(e => {
    console.error("Error:", e);
    process.exit(1);
});
