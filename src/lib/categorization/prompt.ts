import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface CategorizationPromptItem {
	itemId: string;
	name: string;
	brand: string | null;
	category: string | null;
	subcategory: string | null;
	unit: string | null;
	unitQuantity: string | null;
	chainSlug: string | null;
}

const PROMPT_PATH = resolve(
	process.cwd(),
	"docs/categorization/categorization-prompt.md",
);

let cachedPromptMarkdown: string | null = null;

async function readPromptMarkdown(): Promise<string> {
	if (cachedPromptMarkdown) {
		return cachedPromptMarkdown;
	}

	const raw = await readFile(PROMPT_PATH, "utf-8");
	cachedPromptMarkdown = raw;
	return raw;
}

function buildInputPayload(items: readonly CategorizationPromptItem[]): string {
	return JSON.stringify(
		items.map((item) => ({
			item_id: item.itemId,
			name: item.name,
			brand: item.brand,
			category: item.category,
			subcategory: item.subcategory,
			unit: item.unit,
			unit_quantity: item.unitQuantity,
			chain_slug: item.chainSlug,
		})),
		null,
		2,
	);
}

export async function buildCategorizationMessages(
	items: readonly CategorizationPromptItem[],
): Promise<{ systemMessage: string; userMessage: string }> {
	const promptMarkdown = await readPromptMarkdown();
	const inputJson = buildInputPayload(items);

	const systemMessage =
		"You are a Croatian product categorization expert. Return strict JSON only.";
	const userMessage = `${promptMarkdown}

## Input Items

Categorize all items below:

${inputJson}

## Output JSON Schema (strict)

Return ONLY a JSON object with this shape:
{
  "results": [
    {
      "item_id": "string",
      "confidence": 0.95,
      "product_type": "string | null",
      "brand": "string | null",
      "everyday_name": "string | null",
      "variant": "string | null",
      "unit": "string | null",
      "amount": "string | null",
      "package_size": "string | null",
      "container": "PET | limenka | staklo | tetrapak | tuba | null",
      "search_tags": ["string"]
    }
  ]
}
`;

	return { systemMessage, userMessage };
}
