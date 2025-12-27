import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const buildEnv = process.env.BUILD_ENV
const configPath = buildEnv ? `./wrangler.${buildEnv}.jsonc` : './wrangler.jsonc'

// Generate build metadata at build time
const getBuildMetadata = () => {
  try {
    const buildTime = new Date().toISOString()
    const gitCommit = execSync('git rev-parse HEAD').toString().trim().slice(0, 8)
    const environment = buildEnv || process.env.NODE_ENV || 'development'

    return {
      buildTime,
      gitCommit,
      environment,
    }
  } catch (error) {
    console.warn('Warning: Could not generate build metadata:', error)
    return {
      buildTime: new Date().toISOString(),
      gitCommit: 'unknown',
      environment: buildEnv || process.env.NODE_ENV || 'development',
    }
  }
}

const buildMetadata = getBuildMetadata()

const config = defineConfig({
  define: {
    'process.env.BUILD_TIME': JSON.stringify(buildMetadata.buildTime),
    'process.env.GIT_COMMIT': JSON.stringify(buildMetadata.gitCommit),
    'process.env.BUILD_ENV': JSON.stringify(buildMetadata.environment),
  },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' }, configPath }),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  ssr: {
    optimizeDeps: {
      exclude: ['@tanstack/react-query-devtools', '@tanstack/react-router-devtools'],
      include: [
        '@orpc/server',
        '@orpc/client',
        '@orpc/client/fetch',
        '@orpc/tanstack-query',
        '@orpc/openapi/fetch',
        '@orpc/zod/zod4',
        '@orpc/json-schema',
        '@orpc/openapi/plugins',
        'zod',
      ],
    },
  },
})

export default config
