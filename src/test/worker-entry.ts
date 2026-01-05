/**
 * Minimal worker entry point for vitest-pool-workers tests.
 * This file is required by @cloudflare/vitest-pool-workers.
 */
export default {
  async fetch(): Promise<Response> {
    return new Response('Test worker')
  },
}
