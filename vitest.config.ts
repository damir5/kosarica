import {
  defineWorkersConfig,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers/config'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import path from 'node:path'
import fs from 'node:fs'

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(process.cwd(), 'drizzle')
  const migrations = await readD1Migrations(migrationsPath)

  return {
    plugins: [
      viteTsConfigPaths({
        projects: ['./tsconfig.json'],
      }),
    ],
    test: {
      globals: true,
      include: ['src/**/*.test.ts'],
      exclude: ['node_modules', 'dist'],
      setupFiles: ['./src/test/setup.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.test.jsonc' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
            },
          },
          // Service bindings are defined at the workers pool level
          serviceBindings: {
            FILE_ACCESS: {
              fetch(request) {
                const url = new URL(request.url)
                const method = url.searchParams.get('method') as
                  | 'exists'
                  | 'readdir'
                  | 'read'
                  | 'getSampleDataDir'
                const filePath = url.searchParams.get('path')

                try {
                  switch (method) {
                    case 'getSampleDataDir': {
                      const sampleDataDir =
                        process.env.SAMPLE_DATA_DIR ||
                        path.join(process.cwd(), 'sample')
                      return Response.json({ success: true, data: sampleDataDir })
                    }
                    case 'exists': {
                      if (!filePath) {
                        return Response.json(
                          { success: false, error: 'Missing path parameter' },
                          { status: 400 },
                        )
                      }
                      const exists = fs.existsSync(filePath)
                      return Response.json({ success: true, data: exists })
                    }
                    case 'readdir': {
                      if (!filePath) {
                        return Response.json(
                          { success: false, error: 'Missing path parameter' },
                          { status: 400 },
                        )
                      }
                      const files = fs.readdirSync(filePath)
                      return Response.json({ success: true, data: files })
                    }
                    case 'read': {
                      if (!filePath) {
                        return Response.json(
                          { success: false, error: 'Missing path parameter' },
                          { status: 400 },
                        )
                      }
                      const buffer = fs.readFileSync(filePath)
                      return new Response(buffer)
                    }
                    default:
                      return Response.json(
                        { success: false, error: 'Unknown method' },
                        { status: 400 },
                      )
                  }
                } catch (error) {
                  return Response.json(
                    {
                      success: false,
                      error:
                        error instanceof Error ? error.message : String(error),
                    },
                    { status: 500 },
                  )
                }
              },
            },
          },
        },
      },
    },
  }
})
