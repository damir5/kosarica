import { readFileSync } from 'node:fs';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

const apiKey = readFileSync('../shared/secrets/api-keys/staging-claude-agent', 'utf8').trim();
const link = new RPCLink({
  url: 'https://kosarica.chickenkiller.com/api/rpc',
  headers: {
    'x-api-key': apiKey,
  },
});
const client = createORPCClient(link);

const result = await client.admin.ingestion.triggerChain({
  chain: 'interspar',
  targetDate: '2026-02-08',
  force: true,
  priority: 10,
});

console.log(JSON.stringify(result));
