package ingestion

import (
	"context"
	"sync"

	"github.com/rs/zerolog/log"
	"golang.org/x/sync/semaphore"
)

var (
	clusterSemaphore *semaphore.Weighted
	semaphoreOnce    sync.Once
	semaphoreSlots   int64
)

// InitClusterSemaphore initializes the cluster semaphore based on heap size.
// It allows 1 concurrent cluster task per 1GB of configured heap.
// This should be called once during server startup.
func InitClusterSemaphore(heapMB int) {
	semaphoreOnce.Do(func() {
		slots := int64(heapMB / 1024) // 1 slot per 1GB
		if slots < 1 {
			slots = 1
		}
		semaphoreSlots = slots
		clusterSemaphore = semaphore.NewWeighted(slots)

		log.Info().
			Int("heapMB", heapMB).
			Int64("clusterSlots", slots).
			Msg("Initialized cluster semaphore")
	})
}

// AcquireClusterSlot acquires a slot for cluster task execution.
// It blocks until a slot is available or the context is cancelled.
func AcquireClusterSlot(ctx context.Context) error {
	if clusterSemaphore == nil {
		// Semaphore not initialized - allow all (for backwards compatibility)
		log.Warn().Msg("Cluster semaphore not initialized, allowing unlimited concurrency")
		return nil
	}

	log.Debug().Msg("Waiting to acquire cluster slot")
	if err := clusterSemaphore.Acquire(ctx, 1); err != nil {
		return err
	}
	log.Debug().Msg("Acquired cluster slot")
	return nil
}

// ReleaseClusterSlot releases a cluster slot after task completion.
func ReleaseClusterSlot() {
	if clusterSemaphore == nil {
		return
	}
	clusterSemaphore.Release(1)
	log.Debug().Msg("Released cluster slot")
}

// GetClusterSlots returns the number of available cluster slots.
func GetClusterSlots() int64 {
	return semaphoreSlots
}
