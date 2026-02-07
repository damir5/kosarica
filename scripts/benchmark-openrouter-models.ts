import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { evaluatePairWithCascade } from '@/lib/semantic-clustering';

type FinalStatus = 'APPROVED' | 'REJECTED' | 'PENDING_REVIEW' | 'SYSTEM_ERROR';

type DecisionRow = {
  item_a_id: string;
  item_b_id: string;
  normalized_name_a: string;
  normalized_name_b: string;
  extracted_brand_a: string | null;
  extracted_brand_b: string | null;
  normalized_category_a: string | null;
  normalized_category_b: string | null;
  total_amount_a: number | null;
  total_amount_b: number | null;
  extracted_unit_a: string | null;
  extracted_unit_b: string | null;
  pack_amount_a: number | null;
  pack_amount_b: number | null;
  container_type_a: string | null;
  container_type_b: string | null;
  item_name_a: string;
  item_name_b: string;
};

type OpenRouterModel = {
  id: string;
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    web_search?: string;
  };
};

type PairResult = {
  model: string;
  pairKey: string;
  itemAId: string;
  itemBId: string;
  itemAName: string;
  itemBName: string;
  verdict: string;
  confidence: number;
  decisionState: string;
  finalStatus: FinalStatus;
  voteLatencyMs: number | null;
  totalLatencyMs: number;
  systemError: string | null;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
};

type ModelSummary = {
  model: string;
  rounds: number;
  batchSize: number;
  totalPairs: number;
  successPairs: number;
  errorPairs: number;
  approved: number;
  rejected: number;
  pending: number;
  systemError: number;
  exactMatch: number;
  sameBaseDifferentVariant: number;
  mismatch: number;
  uncertain: number;
  avgConfidence: number;
  avgVoteLatencyMs: number;
  p50VoteLatencyMs: number;
  p95VoteLatencyMs: number;
  avgTotalLatencyMs: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  majorityAgreementRate: number;
  costPer1kPairsUsd: number;
  avgMsPerPair: number;
  pairsPerMinute: number;
  pricePromptPerTokenUsd: number;
  priceCompletionPerTokenUsd: number;
};

const DEFAULT_MODELS = [
  'openai/gpt-oss-120b:free',
  'z-ai/glm-4.5-air:free',
  'deepseek/deepseek-r1-0528:free',
  'deepseek/deepseek-v3.2',
  'x-ai/grok-4.1-fast',
  'openai/gpt-5-nano',
  'openai/gpt-4.1-nano',
  'openai/gpt-4.1-mini',
  'google/gemini-2.5-flash',
  'google/gemini-3-flash-preview',
] as const;

const MODELS = (process.env.BENCH_MODELS ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

const ACTIVE_MODELS = MODELS.length > 0 ? MODELS : [...DEFAULT_MODELS];

const ROUNDS = Number.parseInt(process.env.BENCH_ROUNDS ?? '3', 10);
const BATCH_SIZE = Number.parseInt(process.env.BENCH_BATCH_SIZE ?? '8', 10);
const CONCURRENCY = Number.parseInt(process.env.BENCH_CONCURRENCY ?? '4', 10);
const TOTAL_SAMPLE = ROUNDS * BATCH_SIZE;

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (
    typeof result === 'object' &&
    result !== null &&
    'rows' in result &&
    Array.isArray((result as { rows: unknown[] }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function decideFinalStatus(state: string): FinalStatus {
  if (state === 'AUTO_APPROVED') {
    return 'APPROVED';
  }
  if (state === 'AUTO_REJECTED') {
    return 'REJECTED';
  }
  if (state === 'SYSTEM_ERROR') {
    return 'SYSTEM_ERROR';
  }
  return 'PENDING_REVIEW';
}

function buildPromptLikeProduction(itemA: Record<string, unknown>, itemB: Record<string, unknown>): string {
  return `You are an expert grocery product matcher for Croatian retail catalogs.\nDetermine relationship between Item A and Item B.\n\nAllowed verdicts:\n- EXACT_MATCH: same exact sellable variant.\n- SAME_BASE_DIFFERENT_VARIANT: same base product but size/pack/container variant.\n- MISMATCH: different product.\n- UNCERTAIN: not enough confidence.\n\nRules:\n1) Brand mismatch usually means MISMATCH unless obvious same family spelling.\n2) Flavor/variant mismatch means MISMATCH.\n3) 330g and 0.33kg are equivalent quantities.\n4) Multipack can be SAME_BASE_DIFFERENT_VARIANT vs single.\n5) Container changes (can/bottle/glass) are SAME_BASE_DIFFERENT_VARIANT.\n6) Be conservative. If not sure, return UNCERTAIN.\n\nItem A:\n${JSON.stringify(itemA)}\n\nItem B:\n${JSON.stringify(itemB)}\n\nRespond JSON only:\n{"verdict":"EXACT_MATCH|SAME_BASE_DIFFERENT_VARIANT|MISMATCH|UNCERTAIN","confidence":0.0,"reasoning":"..."}`;
}

function estimateTokensByChars(charCount: number): number {
  return Math.max(1, Math.ceil(charCount / 4));
}

function csvEscape(value: string | number | null): string {
  if (value === null) {
    return '';
  }
  const asString = String(value);
  if (asString.includes(',') || asString.includes('"') || asString.includes('\n')) {
    return `"${asString.replace(/"/g, '""')}"`;
  }
  return asString;
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array<U>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: safeConcurrency }, async () => {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

async function getOpenRouterPricing(): Promise<Map<string, { prompt: number; completion: number }>> {
  const response = await fetch('https://openrouter.ai/api/v1/models');
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenRouter models: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as { data?: OpenRouterModel[] };
  const pricing = new Map<string, { prompt: number; completion: number }>();
  for (const model of payload.data ?? []) {
    const prompt = Number.parseFloat(model.pricing?.prompt ?? '0');
    const completion = Number.parseFloat(model.pricing?.completion ?? '0');
    pricing.set(model.id, {
      prompt: Number.isFinite(prompt) ? prompt : 0,
      completion: Number.isFinite(completion) ? completion : 0,
    });
  }
  return pricing;
}

async function main(): Promise<void> {
  const db = getDatabase();
  const pricingByModel = await getOpenRouterPricing();

  const sampleRowsResult = await db.execute(sql`
    SELECT
      d.item_a_id,
      d.item_b_id,
      fa.normalized_name AS normalized_name_a,
      fb.normalized_name AS normalized_name_b,
      fa.extracted_brand AS extracted_brand_a,
      fb.extracted_brand AS extracted_brand_b,
      fa.normalized_category AS normalized_category_a,
      fb.normalized_category AS normalized_category_b,
      fa.total_amount AS total_amount_a,
      fb.total_amount AS total_amount_b,
      fa.extracted_unit AS extracted_unit_a,
      fb.extracted_unit AS extracted_unit_b,
      fa.pack_amount AS pack_amount_a,
      fb.pack_amount AS pack_amount_b,
      fa.container_type AS container_type_a,
      fb.container_type AS container_type_b,
      ria.name AS item_name_a,
      rib.name AS item_name_b
    FROM semantic_pair_decisions d
    JOIN retailer_item_features fa ON fa.retailer_item_id = d.item_a_id
    JOIN retailer_item_features fb ON fb.retailer_item_id = d.item_b_id
    JOIN retailer_items ria ON ria.id = d.item_a_id
    JOIN retailer_items rib ON rib.id = d.item_b_id
    WHERE d.llm_verdict IS NULL
    ORDER BY d.created_at ASC
    LIMIT ${TOTAL_SAMPLE}
  `);

  const sampleRows = getRows<DecisionRow>(sampleRowsResult);
  if (sampleRows.length === 0) {
    throw new Error('No pending pairs (llm_verdict IS NULL) found for benchmark');
  }

  console.log(`Using ${sampleRows.length} fixed pairs (${ROUNDS} rounds x ${BATCH_SIZE}, concurrency ${CONCURRENCY})`);
  console.log('Models:', ACTIVE_MODELS.join(', '));

  const allResults: PairResult[] = [];

  for (const model of ACTIVE_MODELS) {
    const ensemble = [
      {
        id: 'bench-primary',
        provider: 'openrouter',
        model,
        apiKeyEnv: 'OPENROUTER_API_KEY',
        timeoutMs: 30000,
        maxRetries: 0,
      },
    ];
    process.env.LLM_ENSEMBLE_JSON = JSON.stringify(ensemble);

    const modelPrice = pricingByModel.get(model) ?? { prompt: 0, completion: 0 };
    console.log(`\n--- Benchmarking ${model} ---`);

    for (let roundIndex = 0; roundIndex < ROUNDS; roundIndex += 1) {
      const start = roundIndex * BATCH_SIZE;
      const roundRows = sampleRows.slice(start, start + BATCH_SIZE);
      console.log(`Round ${roundIndex + 1}/${ROUNDS} for ${model}...`);
      const roundResults = await mapWithConcurrency(
        roundRows,
        CONCURRENCY,
        async (row, inRoundIndex) => {
          const itemA = {
            name: row.item_name_a,
            brand: row.extracted_brand_a,
            category: row.normalized_category_a,
            normalizedName: row.normalized_name_a,
            amount: row.total_amount_a,
            unit: row.extracted_unit_a,
            packAmount: row.pack_amount_a ?? 1,
            containerType: row.container_type_a,
          };
          const itemB = {
            name: row.item_name_b,
            brand: row.extracted_brand_b,
            category: row.normalized_category_b,
            normalizedName: row.normalized_name_b,
            amount: row.total_amount_b,
            unit: row.extracted_unit_b,
            packAmount: row.pack_amount_b ?? 1,
            containerType: row.container_type_b,
          };

          const prompt = buildPromptLikeProduction(itemA, itemB);
          const estimatedInputTokens = estimateTokensByChars(prompt.length + 32);

          const startedAt = Date.now();
          const cascade = await evaluatePairWithCascade({ itemA, itemB });
          const totalLatencyMs = Date.now() - startedAt;
          const firstVote = cascade.votes[0];

          const outputPayload = firstVote
            ? JSON.stringify({
                verdict: firstVote.verdict,
                confidence: firstVote.confidence,
                reasoning: firstVote.reasoning,
              })
            : JSON.stringify({ verdict: cascade.finalVerdict, confidence: cascade.finalConfidence, reasoning: cascade.systemError ?? '' });
          const estimatedOutputTokens = estimateTokensByChars(outputPayload.length);
          const estimatedCostUsd =
            (estimatedInputTokens * modelPrice.prompt) +
            (estimatedOutputTokens * modelPrice.completion);

          const pairResult: PairResult = {
            model,
            pairKey: `${row.item_a_id}::${row.item_b_id}`,
            itemAId: row.item_a_id,
            itemBId: row.item_b_id,
            itemAName: row.item_name_a,
            itemBName: row.item_name_b,
            verdict: cascade.finalVerdict,
            confidence: cascade.finalConfidence,
            decisionState: cascade.decisionState,
            finalStatus: decideFinalStatus(cascade.decisionState),
            voteLatencyMs: firstVote?.latencyMs ?? null,
            totalLatencyMs,
            systemError: cascade.systemError,
            estimatedInputTokens,
            estimatedOutputTokens,
            estimatedCostUsd,
          };

          const globalPairIndex = start + inRoundIndex + 1;
          const status = pairResult.systemError ? 'ERR' : pairResult.finalStatus;
          console.log(
            `${model} r${roundIndex + 1}#${inRoundIndex + 1}/${roundRows.length} pair ${globalPairIndex}/${sampleRows.length}: ${pairResult.verdict} (${pairResult.confidence.toFixed(2)}) ${status} ${pairResult.totalLatencyMs}ms`,
          );
          return pairResult;
        },
      );
      allResults.push(...roundResults);
    }
  }

  const majorityByPair = new Map<string, string>();
  const pairs = new Set(allResults.map((row) => row.pairKey));
  for (const pairKey of pairs) {
    const rows = allResults.filter((row) => row.pairKey === pairKey && !row.systemError);
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    majorityByPair.set(pairKey, sorted[0]?.[0] ?? 'UNCERTAIN');
  }

  const summaries: ModelSummary[] = ACTIVE_MODELS.map((model) => {
    const rows = allResults.filter((row) => row.model === model);
    const successRows = rows.filter((row) => !row.systemError);
    const voteLatencies = successRows
      .map((row) => row.voteLatencyMs)
      .filter((value): value is number => value !== null);
    const totalLatencies = rows.map((row) => row.totalLatencyMs);

    const approved = rows.filter((row) => row.finalStatus === 'APPROVED').length;
    const rejected = rows.filter((row) => row.finalStatus === 'REJECTED').length;
    const pending = rows.filter((row) => row.finalStatus === 'PENDING_REVIEW').length;
    const systemError = rows.filter((row) => row.finalStatus === 'SYSTEM_ERROR').length;

    const exactMatch = successRows.filter((row) => row.verdict === 'EXACT_MATCH').length;
    const sameBaseDifferentVariant = successRows.filter((row) => row.verdict === 'SAME_BASE_DIFFERENT_VARIANT').length;
    const mismatch = successRows.filter((row) => row.verdict === 'MISMATCH').length;
    const uncertain = successRows.filter((row) => row.verdict === 'UNCERTAIN').length;

    const majorityAgreementCount = successRows.filter((row) => row.verdict === majorityByPair.get(row.pairKey)).length;
    const majorityAgreementRate = successRows.length > 0 ? majorityAgreementCount / successRows.length : 0;

    const estimatedInputTokens = rows.reduce((sum, row) => sum + row.estimatedInputTokens, 0);
    const estimatedOutputTokens = rows.reduce((sum, row) => sum + row.estimatedOutputTokens, 0);
    const estimatedCostUsd = rows.reduce((sum, row) => sum + row.estimatedCostUsd, 0);

    const avgMsPerPair = average(totalLatencies);
    const pairsPerMinute = avgMsPerPair > 0 ? 60000 / avgMsPerPair : 0;

    const price = pricingByModel.get(model) ?? { prompt: 0, completion: 0 };

    return {
      model,
      rounds: ROUNDS,
      batchSize: BATCH_SIZE,
      totalPairs: rows.length,
      successPairs: successRows.length,
      errorPairs: rows.length - successRows.length,
      approved,
      rejected,
      pending,
      systemError,
      exactMatch,
      sameBaseDifferentVariant,
      mismatch,
      uncertain,
      avgConfidence: average(successRows.map((row) => row.confidence)),
      avgVoteLatencyMs: average(voteLatencies),
      p50VoteLatencyMs: percentile(voteLatencies, 50),
      p95VoteLatencyMs: percentile(voteLatencies, 95),
      avgTotalLatencyMs: average(totalLatencies),
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUsd,
      majorityAgreementRate,
      costPer1kPairsUsd: rows.length > 0 ? (estimatedCostUsd / rows.length) * 1000 : 0,
      avgMsPerPair,
      pairsPerMinute,
      pricePromptPerTokenUsd: price.prompt,
      priceCompletionPerTokenUsd: price.completion,
    };
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = `/tmp/openrouter-model-benchmark-${timestamp}.json`;
  const csvPath = `/tmp/openrouter-model-benchmark-${timestamp}.csv`;
  const summaryCsvPath = `/tmp/openrouter-model-benchmark-summary-${timestamp}.csv`;

  const report = {
    generatedAt: new Date().toISOString(),
    sampleSize: sampleRows.length,
    rounds: ROUNDS,
    batchSize: BATCH_SIZE,
    modelCount: ACTIVE_MODELS.length,
    models: ACTIVE_MODELS,
    summaries,
    detailedRows: allResults,
  };

  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const csvHeader = [
    'model',
    'pair_key',
    'item_a_id',
    'item_b_id',
    'item_a_name',
    'item_b_name',
    'verdict',
    'confidence',
    'decision_state',
    'final_status',
    'vote_latency_ms',
    'total_latency_ms',
    'system_error',
    'estimated_input_tokens',
    'estimated_output_tokens',
    'estimated_cost_usd',
    'majority_verdict',
    'agrees_with_majority',
  ];
  const csvLines = [csvHeader.join(',')];
  for (const row of allResults) {
    const majority = majorityByPair.get(row.pairKey) ?? 'UNCERTAIN';
    const agrees = row.systemError ? '' : String(row.verdict === majority);
    csvLines.push([
      csvEscape(row.model),
      csvEscape(row.pairKey),
      csvEscape(row.itemAId),
      csvEscape(row.itemBId),
      csvEscape(row.itemAName),
      csvEscape(row.itemBName),
      csvEscape(row.verdict),
      csvEscape(row.confidence.toFixed(4)),
      csvEscape(row.decisionState),
      csvEscape(row.finalStatus),
      csvEscape(row.voteLatencyMs),
      csvEscape(row.totalLatencyMs),
      csvEscape(row.systemError),
      csvEscape(row.estimatedInputTokens),
      csvEscape(row.estimatedOutputTokens),
      csvEscape(row.estimatedCostUsd.toFixed(8)),
      csvEscape(majority),
      csvEscape(agrees),
    ].join(','));
  }
  writeFileSync(csvPath, csvLines.join('\n'));

  const summaryHeader = [
    'model',
    'rounds',
    'batch_size',
    'total_pairs',
    'success_pairs',
    'error_pairs',
    'approved',
    'rejected',
    'pending',
    'system_error',
    'exact_match',
    'same_base_different_variant',
    'mismatch',
    'uncertain',
    'avg_confidence',
    'avg_vote_latency_ms',
    'p50_vote_latency_ms',
    'p95_vote_latency_ms',
    'avg_total_latency_ms',
    'estimated_input_tokens',
    'estimated_output_tokens',
    'estimated_cost_usd',
    'cost_per_1k_pairs_usd',
    'majority_agreement_rate',
    'pairs_per_minute',
    'prompt_price_per_token_usd',
    'completion_price_per_token_usd',
  ];
  const summaryLines = [summaryHeader.join(',')];
  for (const row of summaries) {
    summaryLines.push([
      csvEscape(row.model),
      csvEscape(row.rounds),
      csvEscape(row.batchSize),
      csvEscape(row.totalPairs),
      csvEscape(row.successPairs),
      csvEscape(row.errorPairs),
      csvEscape(row.approved),
      csvEscape(row.rejected),
      csvEscape(row.pending),
      csvEscape(row.systemError),
      csvEscape(row.exactMatch),
      csvEscape(row.sameBaseDifferentVariant),
      csvEscape(row.mismatch),
      csvEscape(row.uncertain),
      csvEscape(row.avgConfidence.toFixed(4)),
      csvEscape(Math.round(row.avgVoteLatencyMs)),
      csvEscape(row.p50VoteLatencyMs),
      csvEscape(row.p95VoteLatencyMs),
      csvEscape(Math.round(row.avgTotalLatencyMs)),
      csvEscape(row.estimatedInputTokens),
      csvEscape(row.estimatedOutputTokens),
      csvEscape(row.estimatedCostUsd.toFixed(8)),
      csvEscape(row.costPer1kPairsUsd.toFixed(4)),
      csvEscape(row.majorityAgreementRate.toFixed(4)),
      csvEscape(row.pairsPerMinute.toFixed(2)),
      csvEscape(row.pricePromptPerTokenUsd),
      csvEscape(row.priceCompletionPerTokenUsd),
    ].join(','));
  }
  writeFileSync(summaryCsvPath, summaryLines.join('\n'));

  console.log('\nBenchmark complete.');
  console.log(`JSON: ${jsonPath}`);
  console.log(`Detailed CSV: ${csvPath}`);
  console.log(`Summary CSV: ${summaryCsvPath}`);

  const sortedBySpeed = [...summaries].sort((a, b) => b.pairsPerMinute - a.pairsPerMinute);
  const sortedByCost = [...summaries].sort((a, b) => a.costPer1kPairsUsd - b.costPer1kPairsUsd);
  const sortedByAgreement = [...summaries].sort((a, b) => b.majorityAgreementRate - a.majorityAgreementRate);

  console.log('\nTop by speed (pairs/min):');
  for (const row of sortedBySpeed.slice(0, 5)) {
    console.log(`- ${row.model}: ${row.pairsPerMinute.toFixed(2)} pairs/min, errors=${row.errorPairs}`);
  }

  console.log('\nTop by low estimated cost ($/1k pairs):');
  for (const row of sortedByCost.slice(0, 5)) {
    console.log(`- ${row.model}: $${row.costPer1kPairsUsd.toFixed(4)} / 1k pairs`);
  }

  console.log('\nTop by majority agreement:');
  for (const row of sortedByAgreement.slice(0, 5)) {
    console.log(`- ${row.model}: ${(row.majorityAgreementRate * 100).toFixed(1)}%`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
