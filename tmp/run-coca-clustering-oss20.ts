import 'dotenv/config';
import { and, eq, sql } from 'drizzle-orm';
import { semanticPairDecisions } from '@/db/schema';
import { runSemanticClusteringPipeline } from '@/lib/semantic-clustering';
import { evaluatePairsWithCascadeBatch } from '@/lib/semantic-clustering/llm';
import { getDb } from '@/utils/bindings';
import type { SemanticVerdict } from '@/lib/semantic-clustering/types';

type PairRow = {
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

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

function buildInList(values: readonly string[]) {
  return sql`(${sql.join(values.map((value) => sql`${value}`), sql`, `)})`;
}

function buildPairId(itemAId: string, itemBId: string): string {
  return `${itemAId}|${itemBId}`;
}

function decideFinalStatus(state: string): 'APPROVED' | 'REJECTED' | 'PENDING_REVIEW' | 'SYSTEM_ERROR' {
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

async function loadCocaIds(): Promise<string[]> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT id
    FROM retailer_items
    WHERE merged_into_id IS NULL
      AND (
        lower(name) ~ 'coca[ -]?cola'
        OR lower(coalesce(brand, '')) ~ 'coca[ -]?cola'
      )
    ORDER BY id ASC
  `);

  return getRows<{ id: string }>(rows).map((row) => row.id);
}

async function loadCocaUnresolvedPairs(cocaIds: string[]): Promise<PairRow[]> {
  const db = getDb();
  const idList = buildInList(cocaIds);

  const rows = await db.execute(sql`
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
    WHERE d.final_status IN ('PENDING_REVIEW', 'SYSTEM_ERROR')
      AND (d.item_a_id IN ${idList} OR d.item_b_id IN ${idList})
    ORDER BY d.updated_at ASC
  `);

  return getRows<PairRow>(rows);
}

async function runAdjudicationPass(rows: PairRow[], llmPromptBatchSize: number) {
  const db = getDb();

  let approved = 0;
  let rejected = 0;
  let pendingReview = 0;
  let systemErrors = 0;

  for (let offset = 0; offset < rows.length; offset += llmPromptBatchSize) {
    const batch = rows.slice(offset, offset + llmPromptBatchSize);
    const results = await evaluatePairsWithCascadeBatch({
      pairs: batch.map((row) => ({
        pairId: buildPairId(row.item_a_id, row.item_b_id),
        itemA: {
          name: row.item_name_a,
          brand: row.extracted_brand_a,
          category: row.normalized_category_a,
          normalizedName: row.normalized_name_a,
          amount: row.total_amount_a,
          unit: row.extracted_unit_a,
          packAmount: row.pack_amount_a ?? 1,
          containerType: row.container_type_a,
        },
        itemB: {
          name: row.item_name_b,
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

    for (const row of batch) {
      const pairId = buildPairId(row.item_a_id, row.item_b_id);
      const result = results.get(pairId) ?? {
        votes: [],
        finalVerdict: 'UNCERTAIN' as const,
        finalConfidence: 0,
        consensusScore: 0,
        decisionState: 'SYSTEM_ERROR' as const,
        systemError: 'Missing batched adjudication result',
      };

      const finalStatus = decideFinalStatus(result.decisionState);
      if (finalStatus === 'APPROVED') {
        approved += 1;
      } else if (finalStatus === 'REJECTED') {
        rejected += 1;
      } else if (finalStatus === 'PENDING_REVIEW') {
        pendingReview += 1;
      } else {
        systemErrors += 1;
      }

      await db
        .update(semanticPairDecisions)
        .set({
          llmVerdict: result.finalVerdict,
          llmConfidence: result.finalConfidence,
          llmReasoning: result.votes.map((vote) => `${vote.modelId}: ${vote.reasoning}`).join(' | '),
          consensusScore: result.consensusScore,
          votesJson: JSON.stringify(result.votes),
          finalVerdict: result.finalVerdict as SemanticVerdict,
          finalConfidence: result.finalConfidence,
          finalStatus,
          systemError: result.systemError,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(semanticPairDecisions.itemAId, row.item_a_id),
            eq(semanticPairDecisions.itemBId, row.item_b_id),
          ),
        );
    }
  }

  return {
    adjudicated: rows.length,
    approved,
    rejected,
    pendingReview,
    systemErrors,
  };
}

async function main() {
  const db = getDb();
  const cocaIds = await loadCocaIds();

  if (cocaIds.length === 0) {
    console.log(JSON.stringify({ cocaItems: 0, message: 'No Coca-Cola items found.' }, null, 2));
    return;
  }

  const idList = buildInList(cocaIds);

  await db.execute(sql`
    UPDATE retailer_item_features
    SET updated_at = NOW()
    WHERE retailer_item_id IN ${idList}
  `);

  const queueRun = await runSemanticClusteringPipeline({
    featureBatchSize: 0,
    embeddingBackfillBatchSize: 0,
    candidateSourceBatch: cocaIds.length,
    candidateInsertLimit: 120000,
    semanticNeighborCount: 140,
    lexicalNeighborCount: 140,
    adjudicationBatchSize: 0,
    llmPromptBatchSize: 20,
    rebuildClusters: false,
  });

  const pass1Rows = await loadCocaUnresolvedPairs(cocaIds);
  const pass1 = await runAdjudicationPass(pass1Rows, 12);

  const pass2Rows = await loadCocaUnresolvedPairs(cocaIds);
  const pass2 = pass2Rows.length > 0 ? await runAdjudicationPass(pass2Rows, 1) : {
    adjudicated: 0,
    approved: 0,
    rejected: 0,
    pendingReview: 0,
    systemErrors: 0,
  };

  const rebuildRun = await runSemanticClusteringPipeline({
    featureBatchSize: 0,
    embeddingBackfillBatchSize: 0,
    candidateSourceBatch: 0,
    candidateInsertLimit: 0,
    adjudicationBatchSize: 0,
    llmPromptBatchSize: 1,
    rebuildClusters: true,
  });

  const statusRows = await db.execute(sql`
    SELECT final_status, count(*)::int AS c
    FROM semantic_pair_decisions
    WHERE item_a_id IN ${idList} OR item_b_id IN ${idList}
    GROUP BY final_status
    ORDER BY final_status
  `);

  console.log(
    JSON.stringify(
      {
        cocaItems: cocaIds.length,
        queueRun: {
          candidatesQueued: queueRun.candidatesQueued,
          scoringAutoApproved: queueRun.scoringAutoApproved,
          scoringAutoRejected: queueRun.scoringAutoRejected,
          scoringPendingReview: queueRun.scoringPendingReview,
        },
        pass1,
        pass2,
        rebuildRun: {
          variantClusters: rebuildRun.variantClusters,
          baseClusters: rebuildRun.baseClusters,
        },
        finalStatusCounts: getRows<{ final_status: string; c: number }>(statusRows),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
