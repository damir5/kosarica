/**
 * Custom server entry point for TanStack Start
 *
 * Combines TanStack's fetch handler with Cloudflare Workers queue/scheduled handlers.
 * This allows the application to handle HTTP requests via TanStack Router while also
 * processing queue messages and scheduled cron triggers.
 */

import tanstackHandler, {
  type ServerEntry,
} from '@tanstack/react-start/server-entry'
import {
  queue as ingestionQueue,
  scheduled as ingestionScheduled,
  type IngestionEnv,
} from '@/ingestion/worker'
import type { QueueMessage } from '@/ingestion/core/types'
import {
  ensureRequestContext,
  extractRequestId,
} from '@/utils/request-context'
import { createLogger } from '@/utils/logger'

const logger = createLogger('app')

/**
 * Extended ServerEntry to include Cloudflare Workers-specific handlers
 */
interface CloudflareServerEntry extends ServerEntry {
  scheduled?: (
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ) => void | Promise<void>
  queue?: (
    batch: MessageBatch<unknown>,
    env: Env,
    ctx: ExecutionContext
  ) => void | Promise<void>
}

/**
 * Scheduled handler for cron triggers.
 * Delegates to ingestion worker's scheduled handler.
 */
async function scheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  logger.info('Scheduled handler invoked', {
    cron: controller.cron,
    scheduledTime: new Date(controller.scheduledTime).toISOString(),
  })

  ctx.waitUntil(
    (async () => {
      try {
        await ingestionScheduled(controller, env as IngestionEnv, ctx)
      } catch (error) {
        logger.error('Scheduled handler error', { error })
      }
    })()
  )
}

/**
 * Queue handler for processing messages.
 * Delegates to ingestion worker's queue handler.
 */
async function queue(
  batch: MessageBatch<unknown>,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  logger.info('Queue batch received', { messageCount: batch.messages.length })

  ctx.waitUntil(
    (async () => {
      try {
        await ingestionQueue(
          batch as MessageBatch<QueueMessage>,
          env as IngestionEnv,
          ctx
        )
      } catch (error) {
        logger.error('Queue handler error', { error })
      }
    })()
  )
}

/**
 * Wrap the fetch handler with request context
 */
type StartRequestOptions = Parameters<typeof tanstackHandler.fetch>[1]

const wrappedFetch: ServerEntry['fetch'] = async function (request, maybeOpts) {
  let handlerOpts: StartRequestOptions | undefined

  if (maybeOpts && typeof maybeOpts === 'object' && 'context' in maybeOpts) {
    handlerOpts = maybeOpts as StartRequestOptions
  }

  const requestId = extractRequestId(request)
  return ensureRequestContext(requestId, () =>
    tanstackHandler.fetch(request, handlerOpts)
  )
}

/**
 * Export the worker with fetch, scheduled, and queue handlers
 */
export default {
  fetch: wrappedFetch,
  scheduled,
  queue,
} satisfies CloudflareServerEntry
