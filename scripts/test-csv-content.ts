import { config } from "dotenv";
config({ path: ".env.development" });
config();

async function main() {
    console.log("Checking CSV content...");

    const url = "https://www.konzum.hr/cjenici/download?title=SUPERMARKET%2C%C5%BDITNA+1A+10310+IVANI%C4%86+GRAD%2C0204%2C52881%2C03.02.2026%2C+05-22.CSV";
    console.log("Fetching...");
    const response = await fetch(url);
    const content = Buffer.from(await response.arrayBuffer());

    console.log("Size:", content.length);
    console.log("First 500 bytes:");
    console.log(content.slice(0, 500).toString("utf-8"));
    console.log("\n---");
    console.log("Checking for binary/null bytes...");

    let nullCount = 0;
    let nonAscii = 0;
    for (let i = 0; i < content.length; i++) {
        if (content[i] === 0) nullCount++;
        if (content[i] > 127) nonAscii++;
    }
    console.log("Null bytes:", nullCount);
    console.log("Non-ASCII bytes:", nonAscii);
}

main().catch(e => {
    console.error("Error:", e);
    process.exit(1);
});
