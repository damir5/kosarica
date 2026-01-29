package pipeline

import (
	"context"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

var (
	meter                           = otel.Meter("github.com/kosarica/price-service/pipeline")
	phaseDurationHistogram      metric.Float64Histogram
	entriesPerSecondCounter     metric.Float64Counter
	filesProcessedCounter       metric.Int64Counter
	concurrentWorkersGauge      metric.Int64UpDownCounter
)

func init() {
	var err error

	// Phase duration histogram: measures how long each pipeline phase takes
	phaseDurationHistogram, err = meter.Float64Histogram(
		"ingestion.pipeline.phase.duration",
		metric.WithDescription("Duration of each ingestion pipeline phase"),
		metric.WithUnit("s"),
	)
	if err != nil {
		panic(err)
	}

	// Entries per second counter: measures throughput of persisted entries
	entriesPerSecondCounter, err = meter.Float64Counter(
		"ingestion.pipeline.entries.persisted",
		metric.WithDescription("Number of entries persisted by the ingestion pipeline"),
		metric.WithUnit("{entries}"),
	)
	if err != nil {
		panic(err)
	}

	// Files processed counter: measures number of files processed
	filesProcessedCounter, err = meter.Int64Counter(
		"ingestion.pipeline.files.processed",
		metric.WithDescription("Number of files processed by the ingestion pipeline"),
		metric.WithUnit("{files}"),
	)
	if err != nil {
		panic(err)
	}

	// Concurrent workers gauge: measures current number of parallel workers
	concurrentWorkersGauge, err = meter.Int64UpDownCounter(
		"ingestion.pipeline.workers.concurrent",
		metric.WithDescription("Current number of concurrent file processing workers"),
		metric.WithUnit("{workers}"),
	)
	if err != nil {
		panic(err)
	}
}

// PipelinePhase represents the different phases of the ingestion pipeline
type PipelinePhase string

const (
	PhaseDiscover PipelinePhase = "discover"
	PhaseFetch    PipelinePhase = "fetch"
	PhaseParse    PipelinePhase = "parse"
	PhasePersist  PipelinePhase = "persist"
)

// RecordPhaseDuration records the duration of a pipeline phase
func RecordPhaseDuration(ctx context.Context, phase PipelinePhase, chainID string, duration time.Duration) {
	if phaseDurationHistogram != nil {
		phaseDurationHistogram.Record(
			ctx,
			duration.Seconds(),
			metric.WithAttributes(
				attribute.String("phase", string(phase)),
				attribute.String("chain", chainID),
			),
		)
	}
}

// RecordEntriesPersisted records the number of entries persisted
func RecordEntriesPersisted(ctx context.Context, chainID string, count int) {
	if entriesPerSecondCounter != nil {
		entriesPerSecondCounter.Add(
			ctx,
			float64(count),
			metric.WithAttributes(
				attribute.String("chain", chainID),
			),
		)
	}
}

// RecordFileProcessed records that a file was processed
func RecordFileProcessed(ctx context.Context, chainID string, status string) {
	if filesProcessedCounter != nil {
		filesProcessedCounter.Add(
			ctx,
			1,
			metric.WithAttributes(
				attribute.String("chain", chainID),
				attribute.String("status", status),
			),
		)
	}
}

// IncrementConcurrentWorkers increments the concurrent worker count
func IncrementConcurrentWorkers(ctx context.Context, chainID string) {
	if concurrentWorkersGauge != nil {
		concurrentWorkersGauge.Add(
			ctx,
			1,
			metric.WithAttributes(
				attribute.String("chain", chainID),
			),
		)
	}
}

// DecrementConcurrentWorkers decrements the concurrent worker count
func DecrementConcurrentWorkers(ctx context.Context, chainID string) {
	if concurrentWorkersGauge != nil {
		concurrentWorkersGauge.Add(
			ctx,
			-1,
			metric.WithAttributes(
				attribute.String("chain", chainID),
			),
		)
	}
}
