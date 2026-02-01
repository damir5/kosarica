package pipeline

import (
	"fmt"
	"os"
)

// IngestionResult represents the result of an ingestion run
type IngestionResult struct {
	Success          bool
	RunID            string
	FilesProcessed   int
	EntriesPersisted int
	Errors           []string
}

// getIngestionParallelism calculates the parallelism based on DB pool size
// Returns 40% of DB max connections (conservative to avoid pool exhaustion)
// Can be overridden via INGESTION_PARALLELISM environment variable
func getIngestionParallelism(dbMaxConns int32) int {
	// Check for environment variable override
	if envParallelism := os.Getenv("INGESTION_PARALLELISM"); envParallelism != "" {
		var val int
		if _, err := fmt.Sscanf(envParallelism, "%d", &val); err == nil && val > 0 {
			return val
		}
	}

	// Calculate parallelism as 40% of DB pool (conservative)
	parallelism := int(dbMaxConns * 40 / 100)
	if parallelism < 1 {
		parallelism = 1
	}
	return parallelism
}

