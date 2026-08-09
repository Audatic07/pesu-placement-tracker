import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "."),
      // `server-only` throws on import outside a React Server Component. The
      // bundler resolves it to a no-op via the `react-server` export condition;
      // the test runner has no such condition, so it is aliased away here.
      // Without this, any module carrying the server-only guard is untestable —
      // which is exactly the modules most worth testing.
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
      // lib/db.ts constructs its client at module load, so importing anything
      // that touches it — the submission schema and form decoder included —
      // needs a URL to exist. The pool is lazy, so nothing is connected to:
      // a test that reached the database would hang here rather than pass.
      DATABASE_URL: "postgresql://unused:unused@postgres.invalid:5432/unused",
      // Retry backoff off, so exercising three attempts costs no wall-clock.
      PESU_AUTH_BACKOFF_SCALE: "0",
    },
  },
});
