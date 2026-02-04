#!/usr/bin/env tsx
/**
 * Quick test for a single chain ingestion
 */

import { config } from "dotenv";
import { runIngestion } from "@/ingestion/pipeline";

config({ path: ".env.development" });
config();

async function testChain(chainSlug: string, targetDate: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing chain: ${chainSlug}`);
  console.log(`Target date: ${targetDate}`);
  console.log(`${'='.repeat(60)}\n`);

  const startTime = Date.now();

  try {
    const result = await runIngestion({
      chainSlug,
      targetDate,
      force: true,
      source: 'quick-test',
    });

    const duration = (Date.now() - startTime) / 1000;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Result:`);
    console.log(`  Status: ${result.status}`);
    console.log(`  Run ID: ${result.runId}`);
    console.log(`  Message: ${result.message || 'None'}`);
    console.log(`  Duration: ${duration.toFixed(1)}s`);
    console.log(`${'='.repeat(60)}\n`);

    return result;
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    console.error(`\n❌ Error testing ${chainSlug}:`, error);
    console.error(`  Duration: ${duration.toFixed(1)}s`);
    throw error;
  }
}

const chainSlug = process.argv[2];
const targetDate = process.argv[3] || '2026-02-03';

if (!chainSlug) {
  console.error('Usage: tsx test-single-chain.ts <chain-slug> [target-date]');
  console.error('Example: tsx test-single-chain.ts studenac 2026-02-03');
  console.error('\nAvailable chains: konzum, lidl, plodine, interspar, studenac, kaufland, eurospin, dm, ktc, metro, trgocentar');
  process.exit(1);
}

testChain(chainSlug, targetDate)
  .then(() => {
    console.log('✅ Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
