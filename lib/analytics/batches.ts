import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";

const getBatches = cache(async () =>
  prisma.batch.findMany({
    // 9000+ is reserved for integration/demo cohorts, never real placement years.
    // Keep the records available to admins without publishing fictitious results.
    where: process.env.NODE_ENV === "production" ? { year: { lt: 9000 } } : {},
    orderBy: { year: "desc" },
    select: { year: true, dataVersion: true },
  }),
);

export const getBatchYears = cache(async (): Promise<number[]> => {
  const [batches, populated] = await Promise.all([
    getBatches(),
    prisma.batch.findMany({
      where: {
        ...(process.env.NODE_ENV === "production"
          ? { year: { lt: 9000 } }
          : {}),
        offers: { some: { deletedAt: null, verification: { not: "REMOVED" } } },
      },
      select: { year: true },
    }),
  ]);
  const recorded = new Set(populated.map((batch) => batch.year));
  return [
    ...batches.filter((batch) => recorded.has(batch.year)),
    ...batches.filter((batch) => !recorded.has(batch.year)),
  ].map((batch) => batch.year);
});

export const getAnalyticsVersion = cache(
  async (): Promise<string> =>
    (await getBatches())
      .map((batch) => `${batch.year}:${batch.dataVersion}`)
      .join(","),
);

export const getBatchVersion = cache(
  async (year: number): Promise<number> =>
    (await getBatches()).find((batch) => batch.year === year)?.dataVersion ?? 0,
);
