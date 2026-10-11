import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getBatchVersion } from "./batches";
import { minCohortSize } from "@/lib/privacy/gate";

/** Next.js supplies persistent caching; offline maintenance scripts read directly. */
export function cacheBatchRead<T>(namespace: string, read: (year: number) => Promise<T>) {
  const pending = new Map<string, Promise<T>>();
  return cache(async (year: number): Promise<T> => {
    if (!process.env.NEXT_RUNTIME) return read(year);
    const version = await getBatchVersion(year);
    const parts = [namespace, String(year), String(version), String(minCohortSize())];
    const key = parts.join(":");
    const existing = pending.get(key);
    if (existing) return existing;
    const result = unstable_cache(() => read(year), parts, {
      revalidate: 300, tags: [`offers-${year}`],
    })().finally(() => pending.delete(key));
    pending.set(key, result);
    return result;
  });
}
