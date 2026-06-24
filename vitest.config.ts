import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "eval/**/*.test.ts"],
    environment: "node",
    // Deterministic, offline checks only. Live/LLM evals run on demand
    // via `npm run eval:record`, never in `verify`.
    testTimeout: 20_000,
  },
});
