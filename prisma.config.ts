import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  /*
   * Migrations connect DIRECTLY, never through a pooler.
   *
   * A serverless deployment points DATABASE_URL at a pooled endpoint, because
   * each function instance opens its own connections and a small Postgres runs
   * out of them. But a transaction-mode pooler (Neon's, Supabase's, PgBouncer
   * generally) does not carry the session-level advisory locks Prisma takes to
   * stop two deploys migrating at once — so `migrate deploy` against the pooled
   * URL hangs or fails, and it fails during a build, which is the worst place
   * to discover it.
   *
   * Set DIRECT_DATABASE_URL to the unpooled string wherever you deploy. Locally
   * there is no pooler and DATABASE_URL alone is correct, so this falls back to
   * it rather than demanding both.
   *
   * The datasource is declared only when a URL exists at all: generating the
   * client needs no connection, and `prisma generate` runs from postinstall on
   * every fresh clone, before anyone has written .env.
   */
  ...(process.env.DIRECT_DATABASE_URL
    ? { datasource: { url: env("DIRECT_DATABASE_URL") } }
    : process.env.DATABASE_URL
      ? { datasource: { url: env("DATABASE_URL") } }
      : {}),
});
