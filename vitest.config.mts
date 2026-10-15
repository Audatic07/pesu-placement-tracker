import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "."),
      // Tests run outside the React Server Component environment.
      "server-only": resolve(import.meta.dirname, "test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", "generated/**", ".next/**"],
    env: {
      // The PESU client refuses to run unconfigured. Tests stub fetch, so this
      // is never actually contacted.
      PESU_AUTH_BASE_URL: "https://pesu-auth.invalid",
      // Database modules connect lazily; server tests mock their queries.
      DATABASE_URL: "postgresql://unused:unused@postgres.invalid:5432/unused",
      // Retry backoff off, so exercising retries costs no wall-clock.
      PESU_AUTH_BACKOFF_SCALE: "0",
    },
  },
});
