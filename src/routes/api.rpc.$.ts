import '@/polyfill'

import { RPCHandler } from '@orpc/server/fetch'
import { createFileRoute } from '@tanstack/react-router'
import router from '@/orpc/router'
import { createLogger } from '@/utils/logger'
import { runWithContext, extractRequestId } from '@/utils/request-context'

const log = createLogger('rpc')

const handler = new RPCHandler(router)

async function handle({ request }: { request: Request }) {
  const requestId = extractRequestId(request)

  return runWithContext(requestId, async () => {
    const start = Date.now()
    const url = new URL(request.url)

    log.info('RPC request started', {
      method: request.method,
      path: url.pathname,
    })

    try {
      const { response } = await handler.handle(request, {
        prefix: '/api/rpc',
        context: {},
      })

      const result = response ?? new Response('Not Found', { status: 404 })

      log.info('RPC request completed', {
        method: request.method,
        path: url.pathname,
        status: result.status,
        duration: Date.now() - start,
      })

      return result
    } catch (error) {
      log.error('RPC request failed', {
        method: request.method,
        path: url.pathname,
        duration: Date.now() - start,
      }, error)
      throw error
    }
  })
}

export const Route = createFileRoute('/api/rpc/$')({
  server: {
    handlers: {
      HEAD: handle,
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
})
