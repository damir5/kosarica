import { readFileSync } from 'node:fs';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

const apiKey = readFileSync('../shared/secrets/api-keys/staging-claude-agent','utf8').trim();
const client = createORPCClient(new RPCLink({url:'https://kosarica.chickenkiller.com/api/rpc',headers:{'x-api-key':apiKey}}));

const targets = [
  ['interspar', '2026-02-13'],
  ['eurospin', '2026-02-11'],
  ['kaufland', '2026-02-13'],
  ['ktc', '2026-02-08'],
  ['lidl', '2026-02-11'],
];

for (const [chain, targetDate] of targets) {
  const res = await client.admin.ingestion.triggerChain({ chain, targetDate, force: true, priority: 30 });
  console.log(`${chain} ${targetDate} ${res.status}`);
}
