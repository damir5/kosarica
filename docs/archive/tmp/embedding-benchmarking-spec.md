# Embedding Benchmarking System - Cross-Model Specification

## Overview

This spec enables A/B testing of embedding models (OpenAI, Google, Cohere, local) for product matching, with cost tracking to select the most cost-effective solution at scale.

**Key Insight:** Embeddings from different models are NOT comparable. We benchmark *downstream task performance* (recall, precision, MRR) independently per model, then compare metrics + cost.

---

## Schema Additions

```typescript
// src/db/schema.ts - Add to Phase 7 schema

// ============================================================================
// Embedding Model Registry
// ============================================================================

export const embeddingModels = pgTable('embedding_models', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),  // "text-embedding-3-small"
  provider: text('provider').notNull(),  // "openai" | "google" | "cohere" | "local" | "litellm"
  routeModel: text('route_model').notNull(),  // LiteLLM route: "openai/text-embedding-3-small"
  dimension: integer('dimension').notNull(),  // 1536, 768, etc.
  currency: text('currency').default('USD'),
  pricePer1kTokens: real('price_per_1k_tokens'),  // input token pricing
  maxBatchSize: integer('max_batch_size').default(100),
  rateLimit: integer('rate_limit'),  // requests/min
  enabled: boolean('enabled').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  nameUniq: uniqueIndex('embedding_models_name_uniq').on(table.name),
}));

// ============================================================================
// Embedding Storage (per model)
// ============================================================================

// Store embeddings as bytea for DB-agnostic approach
// Build HNSW indexes in-app (hnswlib/FAISS) per model
export const productEmbeddings = pgTable('product_embeddings', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  productId: text('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  modelId: integer('model_id')
    .notNull()
    .references(() => embeddingModels.id),
  embeddingVersion: text('embedding_version').notNull(),  // hash of preprocess + model params
  dimension: integer('dimension').notNull(),
  vectorBytes: bytea('vector_bytes').notNull(),  // float32[] serialized
  inputTextHash: text('input_text_hash').notNull(),  // detect stale embeddings
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  productModelVersionUniq: uniqueIndex('pe_product_model_version_uniq')
    .on(table.productId, table.modelId, table.embeddingVersion),
  modelIdx: index('pe_model_idx').on(table.modelId),
}));

export const retailerItemEmbeddings = pgTable('retailer_item_embeddings', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  retailerItemId: text('retailer_item_id')
    .notNull()
    .references(() => retailerItems.id, { onDelete: 'cascade' }),
  modelId: integer('model_id')
    .notNull()
    .references(() => embeddingModels.id),
  embeddingVersion: text('embedding_version').notNull(),
  dimension: integer('dimension').notNull(),
  vectorBytes: bytea('vector_bytes').notNull(),
  inputTextHash: text('input_text_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  itemModelVersionUniq: uniqueIndex('rie_item_model_version_uniq')
    .on(table.retailerItemId, table.modelId, table.embeddingVersion),
  modelIdx: index('rie_model_idx').on(table.modelId),
}));

// ============================================================================
// Benchmark Dataset (Ground Truth)
// ============================================================================

export const benchmarkDatasets = pgTable('benchmark_datasets', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  pairCount: integer('pair_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const benchmarkPairs = pgTable('benchmark_pairs', {
  datasetId: integer('dataset_id')
    .notNull()
    .references(() => benchmarkDatasets.id, { onDelete: 'cascade' }),
  queryItemId: text('query_item_id').notNull(),  // retailer_item_id
  candidateProductId: text('candidate_product_id').notNull(),  // product_id
  label: smallint('label').notNull(),  // 1=match, 0=non-match
  confidence: real('confidence'),  // human annotator confidence
  annotatedBy: text('annotated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.datasetId, table.queryItemId, table.candidateProductId] }),
}));

// ============================================================================
// Benchmark Runs & Results
// ============================================================================

export const benchmarkRuns = pgTable('benchmark_runs', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  datasetId: integer('dataset_id')
    .notNull()
    .references(() => benchmarkDatasets.id),
  topK: integer('top_k').default(10),
  status: text('status').default('pending'),  // pending, running, completed, failed
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const benchmarkRunModels = pgTable('benchmark_run_models', {
  id: serial('id').primaryKey(),
  runId: integer('run_id')
    .notNull()
    .references(() => benchmarkRuns.id, { onDelete: 'cascade' }),
  modelId: integer('model_id')
    .notNull()
    .references(() => embeddingModels.id),
  embeddingVersion: text('embedding_version').notNull(),
  indexType: text('index_type').default('hnsw'),  // hnsw, flat, ivf
  threshold: real('threshold'),  // tuned similarity threshold for this model
  status: text('status').default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  runModelVersionUniq: uniqueIndex('brm_run_model_version_uniq')
    .on(table.runId, table.modelId, table.embeddingVersion),
}));

export const benchmarkMetrics = pgTable('benchmark_metrics', {
  runModelId: integer('run_model_id')
    .notNull()
    .references(() => benchmarkRunModels.id, { onDelete: 'cascade' }),
  metric: text('metric').notNull(),  // precision@1, recall@10, mrr, f1, latency_p95_ms
  value: real('value').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.runModelId, table.metric] }),
}));

// ============================================================================
// Cost & Usage Tracking
// ============================================================================

export const embeddingCalls = pgTable('embedding_calls', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  modelId: integer('model_id')
    .notNull()
    .references(() => embeddingModels.id),
  purpose: text('purpose').notNull(),  // corpus_embed, query_embed, benchmark
  batchSize: integer('batch_size').notNull(),
  inputTokens: integer('input_tokens'),  // from provider or estimated
  cost: real('cost'),  // USD, computed at write time
  latencyMs: integer('latency_ms'),
  requestId: text('request_id'),  // from provider if available
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  modelTimeIdx: index('ec_model_time_idx').on(table.modelId, table.createdAt),
}));
```

---

## Go Interfaces

```go
// services/price-service/internal/matching/embedding/types.go

package embedding

import "context"

// EmbeddingModel from database
type EmbeddingModel struct {
    ID               int64
    Name             string
    Provider         string  // "litellm", "openai", "google", "cohere", "local"
    RouteModel       string  // LiteLLM route: "openai/text-embedding-3-small"
    Dimension        int
    PricePer1kTokens float64
    MaxBatchSize     int
    RateLimit        int
}

// EmbeddingRequest for batch processing
type EmbeddingRequest struct {
    Model   EmbeddingModel
    Inputs  []string
    Purpose string // "corpus_embed", "query_embed", "benchmark"
}

// EmbeddingResponse with cost tracking
type EmbeddingResponse struct {
    Vectors     [][]float32
    Dimension   int
    InputTokens int
    Cost        float64
    LatencyMs   int
    RequestID   string
}

// Embedder - unified interface for all providers
type Embedder interface {
    // Embed generates embeddings for a batch of texts
    // Implementations MUST handle retries with exponential backoff
    Embed(ctx context.Context, req EmbeddingRequest) (*EmbeddingResponse, error)

    // EstimateTokens returns estimated token count for cost prediction
    EstimateTokens(text string) int
}

// EmbeddingStore - storage abstraction
type EmbeddingStore interface {
    // StoreProductEmbeddings stores embeddings for products
    StoreProductEmbeddings(ctx context.Context, modelID int64, version string,
        embeddings map[string][]float32) error

    // GetProductEmbedding retrieves a single embedding
    GetProductEmbedding(ctx context.Context, modelID int64, version string,
        productID string) ([]float32, error)

    // StoreItemEmbeddings stores embeddings for retailer items
    StoreItemEmbeddings(ctx context.Context, modelID int64, version string,
        embeddings map[string][]float32) error

    // GetItemEmbedding retrieves a single item embedding
    GetItemEmbedding(ctx context.Context, modelID int64, version string,
        itemID string) ([]float32, error)
}

// VectorIndex - per-model vector index
type VectorIndex interface {
    // Build creates an index for a specific model version
    Build(ctx context.Context, modelID int64, version string) error

    // Query finds nearest neighbors
    Query(ctx context.Context, modelID int64, version string,
        vector []float32, topK int) ([]Neighbor, error)

    // Clear removes index for a model version
    Clear(ctx context.Context, modelID int64, version string) error
}

type Neighbor struct {
    ID         string  // product_id or retailer_item_id
    Similarity float32 // cosine similarity
}

// UsageRecorder - tracks API calls and costs
type UsageRecorder interface {
    Record(ctx context.Context, call EmbeddingCall) error
    GetCostSummary(ctx context.Context, modelID int64, since time.Time) (*CostSummary, error)
}

type EmbeddingCall struct {
    ModelID     int64
    Purpose     string
    BatchSize   int
    InputTokens int
    Cost        float64
    LatencyMs   int
    RequestID   string
}

type CostSummary struct {
    TotalCalls       int64
    TotalTokens      int64
    TotalCost        float64
    AvgLatencyMs     float64
    CostPerThousand  float64 // cost per 1000 embeddings
}
```

---

## LiteLLM Provider Implementation

```go
// services/price-service/internal/matching/embedding/litellm.go

package embedding

import (
    "bytes"
    "context"
    "encoding/json"
    "fmt"
    "io"
    "math"
    "net/http"
    "time"
)

type LiteLLMProvider struct {
    baseURL    string
    apiKey     string
    httpClient *http.Client
    recorder   UsageRecorder
}

type litellmRequest struct {
    Model string   `json:"model"`
    Input []string `json:"input"`
}

type litellmResponse struct {
    Object string `json:"object"`
    Data   []struct {
        Object    string    `json:"object"`
        Index     int       `json:"index"`
        Embedding []float32 `json:"embedding"`
    } `json:"data"`
    Model string `json:"model"`
    Usage struct {
        PromptTokens int `json:"prompt_tokens"`
        TotalTokens  int `json:"total_tokens"`
    } `json:"usage"`
}

func NewLiteLLMProvider(baseURL, apiKey string, recorder UsageRecorder) *LiteLLMProvider {
    return &LiteLLMProvider{
        baseURL: baseURL,
        apiKey:  apiKey,
        httpClient: &http.Client{
            Timeout: 60 * time.Second,
        },
        recorder: recorder,
    }
}

func (p *LiteLLMProvider) Embed(ctx context.Context, req EmbeddingRequest) (*EmbeddingResponse, error) {
    start := time.Now()

    // Split into batches respecting model limits
    batchSize := req.Model.MaxBatchSize
    if batchSize == 0 {
        batchSize = 100
    }

    var allVectors [][]float32
    var totalTokens int

    for i := 0; i < len(req.Inputs); i += batchSize {
        end := i + batchSize
        if end > len(req.Inputs) {
            end = len(req.Inputs)
        }
        batch := req.Inputs[i:end]

        vectors, tokens, err := p.embedBatchWithRetry(ctx, req.Model, batch)
        if err != nil {
            return nil, fmt.Errorf("batch %d: %w", i/batchSize, err)
        }

        allVectors = append(allVectors, vectors...)
        totalTokens += tokens
    }

    latencyMs := int(time.Since(start).Milliseconds())
    cost := float64(totalTokens) / 1000.0 * req.Model.PricePer1kTokens

    resp := &EmbeddingResponse{
        Vectors:     allVectors,
        Dimension:   req.Model.Dimension,
        InputTokens: totalTokens,
        Cost:        cost,
        LatencyMs:   latencyMs,
    }

    // Record usage
    if p.recorder != nil {
        p.recorder.Record(ctx, EmbeddingCall{
            ModelID:     req.Model.ID,
            Purpose:     req.Purpose,
            BatchSize:   len(req.Inputs),
            InputTokens: totalTokens,
            Cost:        cost,
            LatencyMs:   latencyMs,
        })
    }

    return resp, nil
}

func (p *LiteLLMProvider) embedBatchWithRetry(ctx context.Context, model EmbeddingModel,
    texts []string) ([][]float32, int, error) {

    const maxRetries = 5
    var lastErr error

    for attempt := 0; attempt < maxRetries; attempt++ {
        if attempt > 0 {
            // Exponential backoff: 1s, 2s, 4s, 8s, 16s
            backoff := time.Duration(math.Pow(2, float64(attempt-1))) * time.Second
            select {
            case <-ctx.Done():
                return nil, 0, ctx.Err()
            case <-time.After(backoff):
            }
        }

        vectors, tokens, err := p.doEmbed(ctx, model, texts)
        if err == nil {
            return vectors, tokens, nil
        }

        lastErr = err

        // Only retry on rate limits (429) or server errors (5xx)
        if !isRetryableError(err) {
            return nil, 0, err
        }
    }

    return nil, 0, fmt.Errorf("max retries exceeded: %w", lastErr)
}

func (p *LiteLLMProvider) doEmbed(ctx context.Context, model EmbeddingModel,
    texts []string) ([][]float32, int, error) {

    reqBody := litellmRequest{
        Model: model.RouteModel,
        Input: texts,
    }

    body, _ := json.Marshal(reqBody)

    httpReq, err := http.NewRequestWithContext(ctx, "POST",
        p.baseURL+"/embeddings", bytes.NewReader(body))
    if err != nil {
        return nil, 0, err
    }

    httpReq.Header.Set("Content-Type", "application/json")
    httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)

    resp, err := p.httpClient.Do(httpReq)
    if err != nil {
        return nil, 0, err
    }
    defer resp.Body.Close()

    if resp.StatusCode != 200 {
        bodyBytes, _ := io.ReadAll(resp.Body)
        return nil, 0, &EmbeddingError{
            StatusCode: resp.StatusCode,
            Body:       string(bodyBytes),
        }
    }

    var result litellmResponse
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return nil, 0, err
    }

    vectors := make([][]float32, len(result.Data))
    for _, d := range result.Data {
        vectors[d.Index] = d.Embedding
    }

    return vectors, result.Usage.TotalTokens, nil
}

func (p *LiteLLMProvider) EstimateTokens(text string) int {
    // Rough estimate: 4 chars per token (typical for multilingual)
    return len(text) / 4
}

type EmbeddingError struct {
    StatusCode int
    Body       string
}

func (e *EmbeddingError) Error() string {
    return fmt.Sprintf("embedding API error %d: %s", e.StatusCode, e.Body)
}

func isRetryableError(err error) bool {
    if embErr, ok := err.(*EmbeddingError); ok {
        return embErr.StatusCode == 429 || embErr.StatusCode >= 500
    }
    return false
}
```

---

## Benchmark Workflow

```go
// services/price-service/internal/matching/benchmark/runner.go

package benchmark

import (
    "context"
    "fmt"
    "sort"
    "time"
)

type BenchmarkRunner struct {
    db           *pgxpool.Pool
    embedders    map[int64]embedding.Embedder  // modelID -> embedder
    store        embedding.EmbeddingStore
    indexBuilder embedding.VectorIndex
}

type BenchmarkConfig struct {
    DatasetID        int
    ModelIDs         []int64
    TopK             int
    EmbeddingVersion string
}

type BenchmarkResult struct {
    ModelID    int64
    ModelName  string
    Metrics    map[string]float64
    TotalCost  float64
    AvgLatency float64
}

func (r *BenchmarkRunner) Run(ctx context.Context, cfg BenchmarkConfig) ([]BenchmarkResult, error) {
    // 1. Load dataset
    pairs, err := r.loadDataset(ctx, cfg.DatasetID)
    if err != nil {
        return nil, fmt.Errorf("load dataset: %w", err)
    }

    // 2. Get unique query items
    queryItems := r.extractQueryItems(pairs)

    // 3. Run benchmark for each model independently
    var results []BenchmarkResult

    for _, modelID := range cfg.ModelIDs {
        result, err := r.benchmarkModel(ctx, modelID, cfg, queryItems, pairs)
        if err != nil {
            log.Error("benchmark failed", "model", modelID, "error", err)
            continue
        }
        results = append(results, *result)
    }

    // 4. Sort by quality/cost ratio
    sort.Slice(results, func(i, j int) bool {
        // Higher recall@10 per dollar is better
        ratioI := results[i].Metrics["recall@10"] / (results[i].TotalCost + 0.001)
        ratioJ := results[j].Metrics["recall@10"] / (results[j].TotalCost + 0.001)
        return ratioI > ratioJ
    })

    return results, nil
}

func (r *BenchmarkRunner) benchmarkModel(ctx context.Context, modelID int64,
    cfg BenchmarkConfig, queryItems []RetailerItem, pairs []BenchmarkPair) (*BenchmarkResult, error) {

    model, err := r.getModel(ctx, modelID)
    if err != nil {
        return nil, err
    }

    embedder := r.embedders[modelID]
    if embedder == nil {
        return nil, fmt.Errorf("no embedder for model %d", modelID)
    }

    // 1. Ensure all products are embedded
    if err := r.ensureProductEmbeddings(ctx, model, cfg.EmbeddingVersion); err != nil {
        return nil, fmt.Errorf("embed products: %w", err)
    }

    // 2. Build index for this model
    if err := r.indexBuilder.Build(ctx, modelID, cfg.EmbeddingVersion); err != nil {
        return nil, fmt.Errorf("build index: %w", err)
    }

    // 3. Embed query items and run retrieval
    var totalLatency time.Duration
    predictions := make(map[string][]string)  // queryItemID -> predicted product IDs

    for _, item := range queryItems {
        start := time.Now()

        text := normalizeForEmbedding(item)
        resp, err := embedder.Embed(ctx, embedding.EmbeddingRequest{
            Model:   model,
            Inputs:  []string{text},
            Purpose: "benchmark",
        })
        if err != nil {
            continue
        }

        neighbors, err := r.indexBuilder.Query(ctx, modelID, cfg.EmbeddingVersion,
            resp.Vectors[0], cfg.TopK)
        if err != nil {
            continue
        }

        totalLatency += time.Since(start)

        predIDs := make([]string, len(neighbors))
        for i, n := range neighbors {
            predIDs[i] = n.ID
        }
        predictions[item.ID] = predIDs
    }

    // 4. Compute metrics
    metrics := r.computeMetrics(pairs, predictions, cfg.TopK)

    // 5. Get cost summary
    costSummary, _ := r.getCostSummary(ctx, modelID)

    return &BenchmarkResult{
        ModelID:    modelID,
        ModelName:  model.Name,
        Metrics:    metrics,
        TotalCost:  costSummary.TotalCost,
        AvgLatency: float64(totalLatency.Milliseconds()) / float64(len(queryItems)),
    }, nil
}

func (r *BenchmarkRunner) computeMetrics(pairs []BenchmarkPair,
    predictions map[string][]string, topK int) map[string]float64 {

    // Build ground truth map: queryID -> set of matching productIDs
    groundTruth := make(map[string]map[string]bool)
    for _, p := range pairs {
        if p.Label == 1 {
            if groundTruth[p.QueryItemID] == nil {
                groundTruth[p.QueryItemID] = make(map[string]bool)
            }
            groundTruth[p.QueryItemID][p.CandidateProductID] = true
        }
    }

    var (
        totalQueries   int
        hits1, hits10  int
        reciprocalRank float64
        totalPrecision float64
        totalRecall    float64
    )

    for queryID, truth := range groundTruth {
        preds := predictions[queryID]
        if len(preds) == 0 {
            continue
        }
        totalQueries++

        // Precision@K and Recall@K
        hits := 0
        for i, predID := range preds {
            if truth[predID] {
                hits++
                if i == 0 {
                    hits1++
                }
                if i < 10 {
                    hits10++
                }
                if reciprocalRank == 0 || float64(i+1) < 1/reciprocalRank {
                    reciprocalRank += 1.0 / float64(i+1)
                }
            }
        }

        totalPrecision += float64(hits) / float64(len(preds))
        totalRecall += float64(hits) / float64(len(truth))
    }

    n := float64(totalQueries)
    if n == 0 {
        n = 1
    }

    return map[string]float64{
        "precision@" + fmt.Sprint(topK): totalPrecision / n,
        "recall@" + fmt.Sprint(topK):    totalRecall / n,
        "recall@1":                       float64(hits1) / n,
        "recall@10":                      float64(hits10) / n,
        "mrr":                            reciprocalRank / n,
    }
}
```

---

## Model Configuration

```go
// services/price-service/internal/matching/config/models.go

package config

// DefaultModels - seed data for embedding_models table
var DefaultModels = []EmbeddingModelSeed{
    // OpenAI
    {
        Name:             "text-embedding-3-small",
        Provider:         "litellm",
        RouteModel:       "openai/text-embedding-3-small",
        Dimension:        1536,
        PricePer1kTokens: 0.00002,  // $0.02 per 1M tokens
        MaxBatchSize:     2048,
    },
    {
        Name:             "text-embedding-3-large",
        Provider:         "litellm",
        RouteModel:       "openai/text-embedding-3-large",
        Dimension:        3072,
        PricePer1kTokens: 0.00013,  // $0.13 per 1M tokens
        MaxBatchSize:     2048,
    },
    // Google
    {
        Name:             "text-embedding-004",
        Provider:         "litellm",
        RouteModel:       "vertex_ai/text-embedding-004",
        Dimension:        768,
        PricePer1kTokens: 0.000025,
        MaxBatchSize:     250,
    },
    // Cohere
    {
        Name:             "embed-multilingual-v3.0",
        Provider:         "litellm",
        RouteModel:       "cohere/embed-multilingual-v3.0",
        Dimension:        1024,
        PricePer1kTokens: 0.0001,
        MaxBatchSize:     96,
    },
    // Voyage (via OpenRouter)
    {
        Name:             "voyage-3",
        Provider:         "litellm",
        RouteModel:       "voyage/voyage-3",
        Dimension:        1024,
        PricePer1kTokens: 0.00006,
        MaxBatchSize:     128,
    },
    // Local (sentence-transformers)
    {
        Name:             "multilingual-e5-large",
        Provider:         "local",
        RouteModel:       "http://localhost:8000/embed",  // local inference server
        Dimension:        1024,
        PricePer1kTokens: 0,  // free
        MaxBatchSize:     32,
    },
}
```

---

## Cost Tracking Queries

```sql
-- Get cost per model for the last 7 days
SELECT
    m.name as model_name,
    COUNT(*) as total_calls,
    SUM(c.input_tokens) as total_tokens,
    SUM(c.cost) as total_cost,
    AVG(c.latency_ms) as avg_latency_ms,
    SUM(c.cost) / NULLIF(SUM(c.batch_size), 0) * 1000 as cost_per_1k_embeddings
FROM embedding_calls c
JOIN embedding_models m ON m.id = c.model_id
WHERE c.created_at > NOW() - INTERVAL '7 days'
GROUP BY m.id, m.name
ORDER BY total_cost DESC;

-- Get benchmark comparison
SELECT
    m.name as model_name,
    bm.metric,
    bm.value,
    (SELECT SUM(cost) FROM embedding_calls WHERE model_id = m.id) as total_cost_so_far
FROM benchmark_metrics bm
JOIN benchmark_run_models brm ON brm.id = bm.run_model_id
JOIN embedding_models m ON m.id = brm.model_id
JOIN benchmark_runs br ON br.id = brm.run_id
WHERE br.id = $1
ORDER BY bm.metric, bm.value DESC;

-- Cost per match (using benchmark results)
WITH costs AS (
    SELECT
        model_id,
        SUM(cost) as total_cost,
        SUM(batch_size) as total_embeddings
    FROM embedding_calls
    WHERE purpose = 'benchmark'
    GROUP BY model_id
),
quality AS (
    SELECT
        brm.model_id,
        MAX(CASE WHEN bm.metric = 'recall@10' THEN bm.value END) as recall_10
    FROM benchmark_metrics bm
    JOIN benchmark_run_models brm ON brm.id = bm.run_model_id
    GROUP BY brm.model_id
)
SELECT
    m.name,
    c.total_cost,
    c.total_embeddings,
    q.recall_10,
    c.total_cost / NULLIF(q.recall_10, 0) as cost_per_recall_point
FROM embedding_models m
JOIN costs c ON c.model_id = m.id
JOIN quality q ON q.model_id = m.id
ORDER BY cost_per_recall_point;
```

---

## Implementation Order

1. **Schema** - Add tables to Drizzle, run migration
2. **Seed models** - Insert default model configurations
3. **LiteLLM provider** - Implement with retry/backoff
4. **Embedding store** - bytea storage with hash invalidation
5. **Vector index** - HNSW index builder per model (use hnswlib-go)
6. **Benchmark runner** - Dataset loading, metric computation
7. **Admin UI** - Model management, benchmark triggers, results dashboard
8. **Cost reports** - Scheduled queries for cost analysis

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Embedding storage | bytea (not pgvector) | Supports variable dimensions, model isolation |
| Index location | In-app (hnswlib) | Faster iteration, no DB-per-model tables |
| Provider routing | LiteLLM | Unified API, supports all major providers |
| Cost tracking | Per-call recording | Enables precise cost-per-match calculation |
| Benchmark metric | Recall@10 | Primary quality metric for matching tasks |
| Threshold tuning | Per-model | Similarity distributions differ across models |
