# Price Variation Sampling

This repo includes a small driver script to estimate how much pricing varies across stores (per chain), and how frequently prices change over time, by sampling from the existing `store_item_state` + `store_item_price_periods` tables.

## Prerequisites

To analyze real production/test data locally, first sync the remote D1 DB into the local Wrangler SQLite file:

```bash
pnpm db:sync-test
# or
pnpm db:sync-prod
```

## Run

```bash
pnpm analyze:price-variation
pnpm analyze:price-variation --since-days=180 --stores=60 --items=250
pnpm analyze:price-variation --chains=konzum,lidl
pnpm analyze:price-variation --db=.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<file>.sqlite
```

## What it reports

- Store coverage: how many of the sampled items each sampled store has a `store_item_state` row for (proxy for assortment overlap).
- Store clusters: number of distinct “store signatures” (hash of sampled item effective prices per store) and the share of the largest cluster.
- Item price variance: unique effective-price counts per item across sampled stores + modal price share.
- Price change rate: number of price changes per `(store,item)` within the time window (derived from overlapping price periods).

The script lives at `scripts/analyze-price-variation.mjs`.
