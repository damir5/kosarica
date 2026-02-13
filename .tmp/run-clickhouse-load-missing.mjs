import { readFileSync } from 'node:fs';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

const apiKey = readFileSync('../shared/secrets/api-keys/staging-claude-agent', 'utf8').trim();
const link = new RPCLink({
  url: 'https://kosarica.chickenkiller.com/api/rpc',
  headers: { 'x-api-key': apiKey },
});
const client = createORPCClient(link);

const statusBefore = await client.admin.clickhouse.status({});
console.log('before', JSON.stringify(statusBefore));

const result = await client.admin.clickhouse.loadMissing({});
console.log('loadMissing', JSON.stringify(result));

const statusAfter = await client.admin.clickhouse.status({});
console.log('after', JSON.stringify(statusAfter));
