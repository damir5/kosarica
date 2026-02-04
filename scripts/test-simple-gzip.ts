import { config } from "dotenv";
config({ path: ".env.development" });
config();

import { createGzip, gzip as gzipCallback } from "node:zlib";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const gzip = promisify(gzipCallback);

async function main() {
    console.log("Testing different gzip methods...");

    const url = "https://www.konzum.hr/cjenici/download?title=SUPERMARKET%2C%C5%BDITNA+1A+10310+IVANI%C4%86+GRAD%2C0204%2C52881%2C03.02.2026%2C+05-22.CSV";
    console.log("Fetching...");
    const response = await fetch(url);
    const content = Buffer.from(await response.arrayBuffer());
    console.log("Fetched", content.length, "bytes");

    // Method 1: Simple callback-based gzip
    console.log("\nMethod 1: Callback gzip...");
    const start1 = Date.now();
    const compressed1 = await gzip(content);
    console.log("Done in", Date.now() - start1, "ms, size:", compressed1.length);

    // Method 2: Streaming pipeline (current implementation)
    console.log("\nMethod 2: Streaming pipeline...");
    const start2 = Date.now();
    const chunks: Buffer[] = [];
    const gzipStream = createGzip();

    await pipeline(
        Readable.from(content),
        gzipStream,
        async function* (source: AsyncIterable<Buffer>) {
            for await (const chunk of source) {
                chunks.push(chunk);
                yield chunk;
            }
        } as any
    );
    const compressed2 = Buffer.concat(chunks);
    console.log("Done in", Date.now() - start2, "ms, size:", compressed2.length);

    console.log("\nBoth methods completed!");
}

main().catch(e => {
    console.error("Error:", e);
    process.exit(1);
});
