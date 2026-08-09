import "server-only";
import { prisma } from "@/lib/db";

/**
 * Fixed-window rate limiting, stored in Postgres.
 *
 * Database-backed rather than in-memory because the app may run more than one
 * instance, and an in-memory limiter would then be trivially bypassed by
 * spreading requests across them. Fixed windows allow a burst at a boundary;
 * that is an accepted trade for something with no extra infrastructure and no
 * moving parts to maintain in five years' time.
 *
 * Login is the case that matters most: without this, the form is an
 * unthrottled brute-force oracle pointed at PESU's own auth service.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = new Date();
  const windowEndsAt = new Date(now.getTime() + windowSeconds * 1000);

  try {
    const existing = await prisma.rateLimitBucket.findUnique({ where: { key } });

    if (!existing || existing.windowEndsAt <= now) {
      // No bucket, or the previous window has closed: start a fresh one.
      await prisma.rateLimitBucket.upsert({
        where: { key },
        update: { count: 1, windowEndsAt },
        create: { key, count: 1, windowEndsAt },
      });
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.windowEndsAt.getTime() - now.getTime()) / 1000),
        ),
      };
    }

    const updated = await prisma.rateLimitBucket.update({
      where: { key },
      data: { count: { increment: 1 } },
    });

    return {
      allowed: true,
      remaining: Math.max(0, limit - updated.count),
      retryAfterSeconds: 0,
    };
  } catch (error) {
    // Fail open. A database blip should not lock every student out of the app;
    // the limiter is a guard rail, not the security boundary itself.
    console.error("[rate-limit] check failed, allowing request", error);
    return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
  }
}

/** Removes closed windows. Wire to a scheduled job once one exists. */
export async function pruneRateLimitBuckets(): Promise<number> {
  const { count } = await prisma.rateLimitBucket.deleteMany({
    where: { windowEndsAt: { lt: new Date() } },
  });
  return count;
}
