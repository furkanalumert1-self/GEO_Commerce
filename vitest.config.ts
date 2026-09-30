import { defineConfig } from "vitest/config";
import path from "node:path";

const integration = process.argv.some((a) => a.includes("integration"));

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globalSetup: integration ? ["tests/integration/global-setup.ts"] : [],
    fileParallelism: false,
    testTimeout: 30000,
  },
});
