import { readFileSync } from 'node:fs';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

const apiKey = readFileSync('../shared/secrets/api-keys/staging-claude-agent', 'utf8').trim();
const scanLines = readFileSync('/tmp/staging_parquet_scan_robust.out', 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const pairs = new Set();
for (const line of scanLines) {
  const parts = line.split(/\s+/);
  if ((parts[0] === 'CORRUPT' || parts[0] === 'ERROR') && parts.length >= 3) {
    pairs.add(`${parts[1]}|${parts[2]}`);
  }
}

const targets = Array.from(pairs)
  .map((entry) => {
    const [chain, targetDate] = entry.split('|');
    return { chain, targetDate };
  })
  .sort((a, b) => (a.chain === b.chain ? a.targetDate.localeCompare(b.targetDate) : a.chain.localeCompare(b.chain)));

const link = new RPCLink({
  url: 'https://kosarica.chickenkiller.com/api/rpc',
  headers: { 'x-api-key': apiKey },
});
const client = createORPCClient(link);

console.log(`Scheduling ${targets.length} repair ingestion tasks...`);

let ok = 0;
let failed = 0;
for (const target of targets) {
  try {
    await client.admin.ingestion.triggerChain({
      chain: target.chain,
      targetDate: target.targetDate,
      force: true,
      priority: 20,
    });
    ok += 1;
    console.log(`OK ${target.chain} ${target.targetDate}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL ${target.chain} ${target.targetDate} ${message}`);
  }
}

console.log(`Scheduled OK=${ok} FAIL=${failed}`);
