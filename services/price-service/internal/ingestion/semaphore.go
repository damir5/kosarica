package ingestion

import (
	"context"
	"fmt"
	"sync"

	"github.com/rs/zerolog/log"
	"github.com/shirou/gopsutil/v3/mem"
	"golang.org/x/sync/semaphore"
)

var (
	importSemaphore *semaphore.Weighted
	semaphoreOnce   sync.Once
	semaphoreSlots  int64
)

// InitSemaphore initializes the import semaphore with the given concurrency.
// It validates that available system memory is sufficient for the requested concurrency.
// Returns an error if memory is insufficient - caller should exit.
func InitSemaphore(concurrency int, memoryPerJobMB int) error {
	var initErr error

	semaphoreOnce.Do(func() {
		if concurrency < 1 {
			concurrency = 1
		}

		requiredMB := int64(concurrency * memoryPerJobMB)

		// Check available system memory
		vmStat, err := mem.VirtualMemory()
		if err != nil {
			log.Warn().Err(err).Msg("Failed to check system memory, proceeding anyway")
		} else {
			availableMB := int64(vmStat.Available / 1024 / 1024)

			if availableMB < requiredMB {
				initErr = fmt.Errorf(
					"insufficient memory: need %dMB (%d jobs × %dMB), available %dMB. "+
						"Reduce INGESTION_CONCURRENCY or add more memory",
					requiredMB, concurrency, memoryPerJobMB, availableMB,
				)
				return
			}

			log.Info().
				Int64("availableMB", availableMB).
				Int64("requiredMB", requiredMB).
				Int("concurrency", concurrency).
				Int("memoryPerJobMB", memoryPerJobMB).
				Msg("Memory check passed")
		}

		semaphoreSlots = int64(concurrency)
		importSemaphore = semaphore.NewWeighted(semaphoreSlots)

		log.Info().
			Int64("slots", semaphoreSlots).
			Msg("Initialized import semaphore")
	})

	return initErr
}

// AcquireSlot acquires a slot for import task execution.
// It blocks until a slot is available or the context is cancelled.
func AcquireSlot(ctx context.Context) error {
	if importSemaphore == nil {
		log.Warn().Msg("Import semaphore not initialized, allowing unlimited concurrency")
		return nil
	}

	log.Debug().Msg("Waiting to acquire import slot")
	if err := importSemaphore.Acquire(ctx, 1); err != nil {
		return err
	}
	log.Debug().Msg("Acquired import slot")
	return nil
}

// ReleaseSlot releases an import slot after task completion.
func ReleaseSlot() {
	if importSemaphore == nil {
		return
	}
	importSemaphore.Release(1)
	log.Debug().Msg("Released import slot")
}

// GetSlots returns the number of configured import slots.
func GetSlots() int64 {
	return semaphoreSlots
}
