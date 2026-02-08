import 'dotenv/config';
import { and, eq, or, sql } from 'drizzle-orm';
import {
  clusterMembers,
  productClusters,
  retailerItemFeatures,
  semanticPairDecisions,
} from '@/db/schema';
import { runSemanticClusteringPipeline } from '@/lib/semantic-clustering';
import { evaluatePairsWithCascadeBatch } from '@/lib/semantic-clustering/llm';
import { getDb } from '@/utils/bindings';
import type { SemanticVerdict } from '@/lib/semantic-clustering/types';

const ITEM_ID = 'rit_1voHUi5MnzXEt9RwpVAsSP3C';

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

function buildPairId(itemAId: string, itemBId: string): string {
  return `${itemAId}|${itemBId}`;
}

async function main() {
  const db = getDb();

  const featureExistsRows = await db.execute(sql`
    SELECT count(*)::int AS c
    FROM retailer_item_features
    WHERE retailer_item_id = ${ITEM_ID}
  `);
  const featureExists = Number(
    (Array.isArray(featureExistsRows) ? featureExistsRows[0] : featureExistsRows.rows?.[0])?.c ?? 0,
  );
  if (featureExists === 0) {
    throw new Error(`No retailer_item_features row for ${ITEM_ID}`);
  }

  await db
    .update(retailerItemFeatures)
    .set({ updatedAt: new Date() })
    .where(eq(retailerItemFeatures.retailerItemId, ITEM_ID));

  const beforeRows = await db.execute(sql`
    SELECT count(*)::int AS c
    FROM semantic_pair_decisions
    WHERE item_a_id = ${ITEM_ID} OR item_b_id = ${ITEM_ID}
  `);
  const before = Number((Array.isArray(beforeRows) ? beforeRows[0] : beforeRows.rows?.[0])?.c ?? 0);

  const queueRun = await runSemanticClusteringPipeline({
    featureBatchSize: 1,
    embeddingBackfillBatchSize: 1,
    candidateSourceBatch: 1,
    candidateInsertLimit: 50000,
    semanticNeighborCount: 5000,
    lexicalNeighborCount: 5000,
    adjudicationBatchSize: 0,
    llmPromptBatchSize: 25,
    rebuildClusters: false,
  });

  const pendingRows = await db.execute(sql`
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
      AND d.final_status = 'PENDING_REVIEW'
      AND (d.item_a_id = ${ITEM_ID} OR d.item_b_id = ${ITEM_ID})
    ORDER BY d.created_at ASC
  `);

  type PendingRow = {
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

  const pending = (Array.isArray(pendingRows) ? pendingRows : pendingRows.rows ?? []) as PendingRow[];

  let adjudicated = 0;
  let approved = 0;
  let rejected = 0;
  let pendingReview = 0;
  let systemErrors = 0;

  const llmBatchSize = 25;
  for (let offset = 0; offset < pending.length; offset += llmBatchSize) {
    const batch = pending.slice(offset, offset + llmBatchSize);
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
      } else if (finalStatus === 'SYSTEM_ERROR') {
        systemErrors += 1;
      } else {
        pendingReview += 1;
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

      adjudicated += 1;
    }
  }

  const rebuildRun = await runSemanticClusteringPipeline({
    featureBatchSize: 0,
    embeddingBackfillBatchSize: 0,
    candidateSourceBatch: 0,
    candidateInsertLimit: 0,
    adjudicationBatchSize: 0,
    llmPromptBatchSize: 1,
    rebuildClusters: true,
  });

  const afterRows = await db.execute(sql`
    SELECT count(*)::int AS c
    FROM semantic_pair_decisions
    WHERE item_a_id = ${ITEM_ID} OR item_b_id = ${ITEM_ID}
  `);
  const after = Number((Array.isArray(afterRows) ? afterRows[0] : afterRows.rows?.[0])?.c ?? 0);

  const byStatusRows = await db.execute(sql`
    SELECT final_status, count(*)::int AS c
    FROM semantic_pair_decisions
    WHERE item_a_id = ${ITEM_ID} OR item_b_id = ${ITEM_ID}
    GROUP BY final_status
    ORDER BY final_status
  `);

  const clusters = await db
    .select({
      clusterId: clusterMembers.clusterId,
      clusterType: productClusters.clusterType,
      canonicalName: productClusters.canonicalName,
    })
    .from(clusterMembers)
    .leftJoin(productClusters, eq(productClusters.id, clusterMembers.clusterId))
    .where(eq(clusterMembers.retailerItemId, ITEM_ID));

  const byStatus = (Array.isArray(byStatusRows) ? byStatusRows : byStatusRows.rows ?? []) as Array<{
    final_status: string;
    c: number;
  }>;

  console.log(
    JSON.stringify(
      {
        itemId: ITEM_ID,
        beforePairs: before,
        queueRun: {
          featuresUpserted: queueRun.featuresUpserted,
          featureEmbeddingsUpserted: queueRun.featureEmbeddingsUpserted,
          embeddingsBackfilled: queueRun.embeddingsBackfilled,
          candidatesQueued: queueRun.candidatesQueued,
          scoringAutoApproved: queueRun.scoringAutoApproved,
          scoringAutoRejected: queueRun.scoringAutoRejected,
          scoringPendingReview: queueRun.scoringPendingReview,
        },
        itemPendingAdjudication: {
          pendingFound: pending.length,
          adjudicated,
          approved,
          rejected,
          pendingReview,
          systemErrors,
        },
        rebuildRun: {
          variantClusters: rebuildRun.variantClusters,
          baseClusters: rebuildRun.baseClusters,
        },
        afterPairs: after,
        statusBreakdown: byStatus,
        itemClusters: clusters,
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
