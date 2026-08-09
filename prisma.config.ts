import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Only migration and introspection commands need a connection; generating the
  // client does not. Declaring the datasource unconditionally made `env()`
  // throw during `prisma generate`, which postinstall runs — so `npm install`
  // failed on every machine that had not written .env yet, which is every
  // machine on its first clone, and inside any container build.
  ...(process.env.DATABASE_URL ? { datasource: { url: env("DATABASE_URL") } } : {}),
});
