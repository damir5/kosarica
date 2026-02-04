import { config } from "dotenv";
config({ path: ".env.development" });
config();

import { compressGzip } from "@/lib/storage/compression";

async function main() {
    console.log("Testing compression...");

    // Create a 1.2MB buffer similar to the CSV
    const size = 1267971;
    const data = Buffer.alloc(size, "test,data,row\n");
    console.log("Created buffer of size:", data.length);

    console.log("Starting compression...");
    const start = Date.now();
    const compressed = await compressGzip(data);
    const elapsed = Date.now() - start;
    console.log("Compression done in", elapsed, "ms");
    console.log("Compressed size:", compressed.length);
    console.log("Ratio:", (compressed.length / data.length * 100).toFixed(1), "%");
}

main().catch(e => {
    console.error("Error:", e);
    process.exit(1);
});
