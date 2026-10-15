import "server-only";
import { prisma } from "@/lib/db";

export async function checkServices() {
  const checks = await Promise.allSettled([
    (async () => {
      const start = performance.now();
      await prisma.$queryRaw`SELECT 1`;
      return `Database: ${Math.round(performance.now() - start)} ms`;
    })(),
    (async () => {
      const base = process.env.PESU_AUTH_BASE_URL;
      if (!base) throw new Error("unconfigured");
      const start = performance.now();
      const response = await fetch(`${base.replace(/\/+$/, "")}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("unavailable");
      await response.body?.cancel();
      return `PESU-auth health: ${Math.round(performance.now() - start)} ms`;
    })(),
  ]);
  return checks
    .map((check, i) =>
      check.status === "fulfilled"
        ? check.value
        : i === 0
          ? "Database: unavailable"
          : "PESU-auth: unavailable or cold-starting",
    )
    .join(". ");
}
