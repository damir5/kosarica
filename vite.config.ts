import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
// import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'

const buildEnv = process.env.BUILD_ENV || process.env.NODE_ENV || 'development'

// Generate build metadata at build time
const getBuildMetadata = () => {
  try {
    const buildTime = new Date().toISOString()
    const gitCommit = execSync('git rev-parse HEAD').toString().trim().slice(0, 8)

    return {
      buildTime,
      gitCommit,
      environment: buildEnv,
    }
  } catch (error) {
    console.warn('Warning: Could not generate build metadata:', error)
    return {
      buildTime: new Date().toISOString(),
      gitCommit: 'unknown',
      environment: buildEnv,
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
  server: {
    port: 3002,
    strictPort: true,
    watch: {
      ignored: ['**/sample/**', '**/data/**', '**/.pnpm-store/**', '**/node_modules/**'],
    },
  },
  plugins: [
    // Disabled devtools to reduce memory usage - re-enable if needed
    // devtools({ enhancedLogs: { enabled: false } }),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  ssr: {
    // Externalize native Node.js modules
    external: ['bree'],
  },
})

export default config
