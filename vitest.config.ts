import { defineConfig } from "vitest/config";
import viteTsConfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  plugins: [
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
  ],
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    globalSetup: ["./src/test/globalSetup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Use standard Node.js environment
    environment: "node",
    // Run tests sequentially to avoid migration conflicts
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    // Set environment variables for tests
    env: {
      STORAGE_PATH: "./test-data/storage",
      SAMPLE_DATA_DIR: path.join(process.cwd(), "sample-data"),
    },
    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "**/node_modules/**",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
        "**/types/**",
        "**/__mocks__/**",
      ],
    },
  },
})
