import {
  defineWorkersConfig,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers/config'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import path from 'node:path'

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
        },
      },
    },
  }
})
