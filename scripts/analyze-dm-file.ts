import * as XLSX from "xlsx";
import fs from "node:fs";

const filePath = "/tmp/dm-test.xlsx";
const content = fs.readFileSync(filePath);

const workbook = XLSX.read(content, { type: "buffer", cellDates: true });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

const rows = XLSX.utils.sheet_to_json(sheet, {
	header: 1,
	defval: "",
	raw: true,
}) as unknown[][];

console.log(`Total rows: ${rows.length}`);
console.log("\n=== First 5 rows ===");
for (let i = 0; i < Math.min(5, rows.length); i++) {
	console.log(`Row ${i}:`, rows[i]);
}

// Check for rows with empty price (column 9 based on dmWebColumnMapping)
const priceColumnIndex = 9;
let emptyPriceCount = 0;
const emptyPriceExamples: number[] = [];

// Start from row 3 (headerRowCount: 3 in DM adapter)
for (let i = 3; i < rows.length; i++) {
	const row = rows[i];
	const priceValue = row?.[priceColumnIndex];
	const priceStr = String(priceValue ?? "").trim();
	
	if (priceStr === "" || priceStr === "0") {
		emptyPriceCount++;
		if (emptyPriceExamples.length < 10) {
			emptyPriceExamples.push(i + 1); // 1-indexed for display
		}
	}
}

console.log(`\n=== Price Analysis ===`);
console.log(`Empty or zero prices: ${emptyPriceCount} out of ${rows.length - 3} data rows`);
console.log(`Example row numbers with empty prices: ${emptyPriceExamples.join(", ")}`);

// Show a few examples of rows with empty prices
console.log("\n=== Sample rows with empty prices ===");
for (const rowNum of emptyPriceExamples.slice(0, 3)) {
	const row = rows[rowNum - 1];
	console.log(`\nRow ${rowNum}:`);
	console.log(`  Name (col 0): ${row?.[0]}`);
	console.log(`  External ID (col 1): ${row?.[1]}`);
	console.log(`  Brand (col 2): ${row?.[2]}`);
	console.log(`  Category (col 4): ${row?.[4]}`);
	console.log(`  Price (col 9): "${row?.[9]}"`);
	console.log(`  Discount Price (col 10): "${row?.[10]}"`);
}

// Check if these rows have discount prices instead
console.log("\n=== Checking if empty-price rows have discount prices ===");
let hasDiscountPriceCount = 0;
for (let i = 3; i < rows.length; i++) {
	const row = rows[i];
	const priceValue = String(row?.[priceColumnIndex] ?? "").trim();
	const discountPriceValue = String(row?.[10] ?? "").trim();
	
	if ((priceValue === "" || priceValue === "0") && discountPriceValue !== "" && discountPriceValue !== "0") {
		hasDiscountPriceCount++;
	}
}

console.log(`Rows with empty price but non-empty discount price: ${hasDiscountPriceCount}`);
