import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Postgres integration tests are skipped unless TEST_DATABASE_URL is set.
    testTimeout: 30_000,
  },
});
