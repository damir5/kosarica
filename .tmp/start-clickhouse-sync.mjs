import { readFileSync } from 'node:fs';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
const apiKey = readFileSync('../shared/secrets/api-keys/staging-claude-agent','utf8').trim();
const client = createORPCClient(new RPCLink({url:'https://kosarica.chickenkiller.com/api/rpc',headers:{'x-api-key':apiKey}}));
const res = await client.admin.clickhouse.startSync({ mode: 'missing', priority: 25 });
console.log(JSON.stringify(res));
