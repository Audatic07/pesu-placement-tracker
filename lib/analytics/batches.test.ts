import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAnalyticsVersion, getBatchYears } from "./batches";

const database = vi.hoisted(() => ({
  findMany: vi.fn<
    (query: { where: { year?: { lt: number } } }) => Promise<
      Array<{ year: number; dataVersion?: number }>
    >
  >(),
}));
vi.mock("@/lib/db", () => ({ prisma: { batch: database } }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("public batch navigation", () => {
  it("excludes reserved demo years from production reads and revisions", async () => {
    vi.stubEnv("NODE_ENV", "production");
    database.findMany.mockResolvedValue([{ year: 2026, dataVersion: 3 }]);
    expect(await getBatchYears()).toEqual([2026]);
    expect(await getAnalyticsVersion()).toBe("2026:3");
    for (const [query] of database.findMany.mock.calls)
      expect(query.where.year).toEqual({ lt: 9000 });
  });

  it("keeps demo cohorts available locally while preferring populated batches", async () => {
    vi.stubEnv("NODE_ENV", "development");
    database.findMany
      .mockResolvedValueOnce([
        { year: 9998, dataVersion: 1 },
        { year: 2027, dataVersion: 0 },
        { year: 2026, dataVersion: 2 },
      ])
      .mockResolvedValueOnce([{ year: 9998 }, { year: 2026 }]);
    expect(await getBatchYears()).toEqual([9998, 2026, 2027]);
    for (const [query] of database.findMany.mock.calls)
      expect(query.where.year).toBeUndefined();
  });
});
