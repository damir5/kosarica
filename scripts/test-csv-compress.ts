import { config } from "dotenv";
config({ path: ".env.development" });
config();

import { compressGzip, shouldCompress } from "@/lib/storage/compression";

async function main() {
    console.log("Testing CSV compression...");

    const url = "https://www.konzum.hr/cjenici/download?title=SUPERMARKET%2C%C5%BDITNA+1A+10310+IVANI%C4%86+GRAD%2C0204%2C52881%2C03.02.2026%2C+05-22.CSV";
    console.log("Fetching real CSV...");
    const response = await fetch(url);
    const content = Buffer.from(await response.arrayBuffer());
    console.log("Fetched", content.length, "bytes");

    console.log("Should compress csv?", shouldCompress("csv"));

    console.log("Starting compression...");
    const start = Date.now();
    const compressed = await compressGzip(content);
    console.log("Compression completed in", Date.now() - start, "ms");
    console.log("Compressed size:", compressed.length);
    console.log("Ratio:", (compressed.length / content.length * 100).toFixed(1), "%");

    console.log("Done!");
}

main().catch(e => {
    console.error("Error:", e);
    process.exit(1);
});
