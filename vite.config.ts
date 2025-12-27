import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const buildEnv = process.env.BUILD_ENV
const configPath = buildEnv ? `./wrangler.${buildEnv}.jsonc` : './wrangler.jsonc'

const config = defineConfig({
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
