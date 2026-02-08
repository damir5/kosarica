import { execSync } from "child_process";

function selectRandomItems() {
  // Run the query via docker exec
  const query = `
    SELECT
      id,
      name,
      brand,
      chain_slug as "chainSlug",
      unit,
      unit_quantity as "unitQuantity"
    FROM retailer_items
    WHERE merged_into_id IS NULL
    ORDER BY RANDOM()
    LIMIT 200;
  `;

  const result = execSync(`docker exec ade-postgres psql -U kosarica -d kosarica -c "${query.replace(/\n/g, ' ')}" -t -A -F '|'`, {
    encoding: 'utf-8'
  });

  const lines = result.trim().split('\n').filter(line => line.trim());
  const items = lines.map(line => {
    const [id, name, brand, chainSlug, unit, unitQuantity] = line.split('|');
    return {
      id,
      name: name || '',
      brand: brand || null,
      chainSlug,
      unit: unit || null,
      unitQuantity: unitQuantity || null,
    };
  });

  console.log(JSON.stringify(items, null, 2));
}

selectRandomItems();