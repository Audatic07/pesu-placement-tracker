import { spawnSync } from "node:child_process";

// Public forks and PR previews never receive production migration privileges.
// Production migration is an explicit release mode configured by the operator.
const migrate =
  process.env.VERCEL_ENV === "production" &&
  process.env.PRODUCTION_MIGRATIONS === "deploy";
if (migrate) {
  const pooled = new URL(process.env.DATABASE_URL ?? "");
  const direct = new URL(process.env.DIRECT_DATABASE_URL ?? "");
  if (
    pooled.hostname.replace(/-pooler(?=\.)/, "") !== direct.hostname ||
    pooled.pathname !== direct.pathname ||
    pooled.username !== direct.username
  ) {
    throw new Error(
      "Runtime and migration URLs must identify the same PostgreSQL database.",
    );
  }
  if (direct.hostname.includes("-pooler."))
    throw new Error("DIRECT_DATABASE_URL must be unpooled.");
}
for (const args of [
  ["prisma", "migrate", migrate ? "deploy" : "status"],
  ["next", "build"],
]) {
  const result = spawnSync("npx", ["--no-install", ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
