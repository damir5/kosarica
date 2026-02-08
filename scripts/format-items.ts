import { readFileSync, writeFileSync } from "fs";

interface Item {
  id: string;
  name: string;
  brand: string | null;
  chainSlug: string;
  unit: string | null;
  unitQuantity: string | null;
}

const items: Item[] = JSON.parse(readFileSync("random-items.json", "utf-8"));

// Format items for categorization
const formattedItems = items.map((item: Item) => ({
  name: item.name,
  brand: item.brand || "",
  chain: item.chainSlug
}));

// Write to file
writeFileSync("formatted-items.json", JSON.stringify(formattedItems, null, 2));

console.log(`Formatted ${formattedItems.length} items`);