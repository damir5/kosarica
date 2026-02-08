import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { evaluatePairsWithCascadeBatch } from '@/lib/semantic-clustering/llm';

type Topic = 'cola' | 'banana' | 'milk';

type Row = {
  topic: Topic;
  item_a_id: string;
  item_b_id: string;
  item_a_name: string;
  item_b_name: string;
  chain_a: string | null;
  chain_b: string | null;
  emb_sim: number | null;
  lex_sim: number | null;
  normalized_name_a: string | null;
  normalized_name_b: string | null;
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
};

type PairOut = {
  topic: Topic;
  pairKey: string;
  itemAId: string;
  itemBId: string;
  itemAName: string;
  itemBName: string;
  chainA: string | null;
  chainB: string | null;
  embSim: number | null;
  lexSim: number | null;
  verdict: string;
  confidence: number;
  decisionState: string;
  voteLatencyMs: number | null;
  systemError: string | null;
};

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

function avg(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const value of values) {
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}

async function main(): Promise<void> {
  const db = getDatabase();
  const startedAt = Date.now();

  const rowsResult = await db.execute(sql`
    WITH seeds AS (
      SELECT
        f.retailer_item_id,
        f.normalized_name,
        f.normalized_category,
        f.extracted_brand,
        f.extracted_unit,
        f.total_amount,
        f.pack_amount,
        f.container_type,
        f.embedding,
        ri.name AS item_name,
        ri.chain_slug,
        CASE
          WHEN lower(coalesce(f.normalized_name, '')) LIKE '%cola%'
            OR lower(coalesce(ri.name, '')) LIKE '%cola%'
            OR lower(coalesce(f.normalized_name, '')) LIKE '%kola%'
            OR lower(coalesce(ri.name, '')) LIKE '%kola%'
            THEN 'cola'
          WHEN lower(coalesce(f.normalized_name, '')) LIKE '%banan%'
            OR lower(coalesce(ri.name, '')) LIKE '%banan%'
            THEN 'banana'
          WHEN lower(coalesce(f.normalized_name, '')) LIKE '%mlijek%'
            OR lower(coalesce(ri.name, '')) LIKE '%mlijek%'
            OR lower(coalesce(f.normalized_name, '')) LIKE '%milk%'
            OR lower(coalesce(ri.name, '')) LIKE '%milk%'
            THEN 'milk'
          ELSE NULL
        END AS topic
      FROM retailer_item_features f
      JOIN retailer_items ri ON ri.id = f.retailer_item_id
      WHERE (
        lower(coalesce(f.normalized_name, '')) LIKE '%cola%'
        OR lower(coalesce(ri.name, '')) LIKE '%cola%'
        OR lower(coalesce(f.normalized_name, '')) LIKE '%kola%'
        OR lower(coalesce(ri.name, '')) LIKE '%kola%'
        OR lower(coalesce(f.normalized_name, '')) LIKE '%banan%'
        OR lower(coalesce(ri.name, '')) LIKE '%banan%'
        OR lower(coalesce(f.normalized_name, '')) LIKE '%mlijek%'
        OR lower(coalesce(ri.name, '')) LIKE '%mlijek%'
        OR lower(coalesce(f.normalized_name, '')) LIKE '%milk%'
        OR lower(coalesce(ri.name, '')) LIKE '%milk%'
      )
    ),
    ranked_seeds AS (
      SELECT
        *,
        row_number() OVER (PARTITION BY topic ORDER BY random()) AS rn
      FROM seeds
      WHERE topic IS NOT NULL
    ),
    source AS (
      SELECT *
      FROM ranked_seeds
      WHERE rn <= 30
    ),
    candidate_pool AS (
      SELECT
        s.topic,
        s.retailer_item_id AS item_a_id,
        t.retailer_item_id AS item_b_id,
        s.item_name AS item_a_name,
        t.item_name AS item_b_name,
        s.chain_slug AS chain_a,
        t.chain_slug AS chain_b,
        CASE
          WHEN s.embedding IS NOT NULL AND t.embedding IS NOT NULL
            THEN (1 - (s.embedding <=> t.embedding))::real
          ELSE NULL::real
        END AS emb_sim,
        similarity(s.normalized_name, t.normalized_name)::real AS lex_sim,
        s.normalized_name AS normalized_name_a,
        t.normalized_name AS normalized_name_b,
        s.extracted_brand AS extracted_brand_a,
        t.extracted_brand AS extracted_brand_b,
        s.normalized_category AS normalized_category_a,
        t.normalized_category AS normalized_category_b,
        s.total_amount AS total_amount_a,
        t.total_amount AS total_amount_b,
        s.extracted_unit AS extracted_unit_a,
        t.extracted_unit AS extracted_unit_b,
        s.pack_amount AS pack_amount_a,
        t.pack_amount AS pack_amount_b,
        s.container_type AS container_type_a,
        t.container_type AS container_type_b
      FROM source s
      JOIN LATERAL (
        SELECT
          f2.retailer_item_id,
          f2.normalized_name,
          f2.normalized_category,
          f2.extracted_brand,
          f2.extracted_unit,
          f2.total_amount,
          f2.pack_amount,
          f2.container_type,
          f2.embedding,
          ri2.name AS item_name,
          ri2.chain_slug
        FROM retailer_item_features f2
        JOIN retailer_items ri2 ON ri2.id = f2.retailer_item_id
        WHERE f2.retailer_item_id <> s.retailer_item_id
          AND ri2.chain_slug <> s.chain_slug
        ORDER BY
          CASE
            WHEN s.embedding IS NOT NULL AND f2.embedding IS NOT NULL
              THEN s.embedding <=> f2.embedding
            ELSE 10
          END,
          f2.normalized_name <-> s.normalized_name
        LIMIT 8
      ) t ON true
      WHERE (
        (s.embedding IS NOT NULL AND t.embedding IS NOT NULL AND (1 - (s.embedding <=> t.embedding)) >= 0.62)
        OR similarity(s.normalized_name, t.normalized_name) >= 0.30
      )
    ),
    dedup AS (
      SELECT DISTINCT ON (LEAST(item_a_id, item_b_id), GREATEST(item_a_id, item_b_id))
        topic,
        item_a_id,
        item_b_id,
        item_a_name,
        item_b_name,
        chain_a,
        chain_b,
        emb_sim,
        lex_sim,
        normalized_name_a,
        normalized_name_b,
        extracted_brand_a,
        extracted_brand_b,
        normalized_category_a,
        normalized_category_b,
        total_amount_a,
        total_amount_b,
        extracted_unit_a,
        extracted_unit_b,
        pack_amount_a,
        pack_amount_b,
        container_type_a,
        container_type_b
      FROM candidate_pool
      ORDER BY
        LEAST(item_a_id, item_b_id),
        GREATEST(item_a_id, item_b_id),
        emb_sim DESC NULLS LAST,
        lex_sim DESC NULLS LAST
    )
    SELECT *
    FROM dedup
    ORDER BY topic, emb_sim DESC NULLS LAST, lex_sim DESC NULLS LAST
    LIMIT 180
  `);

  const rows = getRows<Row>(rowsResult);
  console.log(`Selected pairs: ${rows.length}`);
  if (rows.length === 0) {
    console.log('No pairs found for cola/banana/milk keywords.');
    return;
  }

  const pairResults: PairOut[] = [];
  const llmPromptBatchSize = Number.parseInt(process.env.SEMANTIC_CLUSTERING_LLM_PROMPT_BATCH_SIZE ?? '25', 10);
  const batchSize = Number.isFinite(llmPromptBatchSize) && llmPromptBatchSize > 0 ? llmPromptBatchSize : 25;

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batchRows = rows.slice(offset, offset + batchSize);
    const response = await evaluatePairsWithCascadeBatch({
      pairs: batchRows.map((row) => ({
        pairId: `${row.item_a_id}::${row.item_b_id}`,
        itemA: {
          name: row.item_a_name,
          brand: row.extracted_brand_a,
          category: row.normalized_category_a,
          normalizedName: row.normalized_name_a,
          amount: row.total_amount_a,
          unit: row.extracted_unit_a,
          packAmount: row.pack_amount_a ?? 1,
          containerType: row.container_type_a,
        },
        itemB: {
          name: row.item_b_name,
          brand: row.extracted_brand_b,
          category: row.normalized_category_b,
          normalizedName: row.normalized_name_b,
          amount: row.total_amount_b,
          unit: row.extracted_unit_b,
          packAmount: row.pack_amount_b ?? 1,
          containerType: row.container_type_b,
        },
      })),
    });

    for (const row of batchRows) {
      const pairKey = `${row.item_a_id}::${row.item_b_id}`;
      const result = response.get(pairKey);
      const firstVote = result?.votes[0] ?? null;

      pairResults.push({
        topic: row.topic,
        pairKey,
        itemAId: row.item_a_id,
        itemBId: row.item_b_id,
        itemAName: row.item_a_name,
        itemBName: row.item_b_name,
        chainA: row.chain_a,
        chainB: row.chain_b,
        embSim: row.emb_sim,
        lexSim: row.lex_sim,
        verdict: result?.finalVerdict ?? 'UNCERTAIN',
        confidence: result?.finalConfidence ?? 0,
        decisionState: result?.decisionState ?? 'SYSTEM_ERROR',
        voteLatencyMs: firstVote?.latencyMs ?? null,
        systemError: result?.systemError ?? 'Missing result',
      });
    }

    console.log(`Processed ${Math.min(offset + batchRows.length, rows.length)}/${rows.length} pairs`);
  }

  const totalMs = Date.now() - startedAt;
  const latencies = pairResults.map((p) => p.voteLatencyMs).filter((v): v is number => v !== null);

  const byTopic = ['cola', 'banana', 'milk'].map((topic) => {
    const rowsForTopic = pairResults.filter((p) => p.topic === topic);
    const verdicts = countBy(rowsForTopic.map((p) => p.verdict));
    const states = countBy(rowsForTopic.map((p) => p.decisionState));
    const topicLatencies = rowsForTopic
      .map((p) => p.voteLatencyMs)
      .filter((v): v is number => v !== null);

    return {
      topic,
      pairs: rowsForTopic.length,
      avgConfidence: avg(rowsForTopic.map((p) => p.confidence)),
      avgVoteLatencyMs: avg(topicLatencies),
      verdicts,
      decisionStates: states,
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    envModelConfig: process.env.LLM_ENSEMBLE_JSON ?? null,
    totalPairs: pairResults.length,
    totalDurationMs: totalMs,
    pairsPerMinuteWallClock: pairResults.length > 0 ? (pairResults.length * 60000) / totalMs : 0,
    avgVoteLatencyMs: avg(latencies),
    avgConfidence: avg(pairResults.map((p) => p.confidence)),
    verdictsOverall: countBy(pairResults.map((p) => p.verdict)),
    decisionStatesOverall: countBy(pairResults.map((p) => p.decisionState)),
    byTopic,
    sampleTop: pairResults.slice(0, 60),
    allPairs: pairResults,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = `/tmp/keyword-match-eval-${timestamp}.json`;
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n=== Keyword Match Eval Summary ===');
  console.log(`Output: ${outPath}`);
  console.log(`Total pairs: ${report.totalPairs}`);
  console.log(`Total duration: ${report.totalDurationMs} ms`);
  console.log(`Wall-clock throughput: ${report.pairsPerMinuteWallClock.toFixed(2)} pairs/min`);
  console.log(`Avg vote latency: ${report.avgVoteLatencyMs.toFixed(2)} ms`);
  console.log(`Avg confidence: ${report.avgConfidence.toFixed(4)}`);
  console.log(`Overall verdicts: ${JSON.stringify(report.verdictsOverall)}`);
  console.log(`Overall decision states: ${JSON.stringify(report.decisionStatesOverall)}`);
  for (const topic of report.byTopic) {
    console.log(
      `Topic ${topic.topic}: pairs=${topic.pairs}, avgLatencyMs=${topic.avgVoteLatencyMs.toFixed(2)}, avgConfidence=${topic.avgConfidence.toFixed(4)}, verdicts=${JSON.stringify(topic.verdicts)}, states=${JSON.stringify(topic.decisionStates)}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
