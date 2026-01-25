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
    setupFiles: ["./src/test/setup.ts"],
    environment: "node",
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    env: {
      STORAGE_PATH: "./test-data/storage",
      SAMPLE_DATA_DIR: path.join(process.cwd(), "sample-data"),
      TEST_MOCK_GO_SERVICE: process.env.TEST_MOCK_GO_SERVICE || "0",
      GO_SERVICE_FOR_TESTS: process.env.GO_SERVICE_FOR_TESTS || "0",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "**/node_modules/**",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/types/**",
        "**/__mocks__/**",
      ],
    },
})
