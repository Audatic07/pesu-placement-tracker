import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryDirectory } from "./directory";

const database = vi.hoisted(() => ({
  offers: vi.fn<() => Promise<unknown[]>>(),
  drives: vi.fn<() => Promise<unknown[]>>(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    offer: { findMany: database.offers },
    drive: { findMany: database.drives },
    batch: { findUnique: vi.fn<() => Promise<{ tierConfigs: never[] }>>() },
  },
}));

vi.mock("next/cache", () => ({ unstable_cache: (read: () => unknown) => read }));
vi.mock("./batches", () => ({ getBatchVersion: async () => 0 }));

function offer(index: number, ctcLpa: number | null = 20) {
  return {
    company: {
      id: String(index), name: `Company ${index}`, slug: `company-${index}`,
      parent: null, aliases: [],
    },
    source: "SELF_REPORTED", roleTitle: "SDE 1", roleFamily: "SDE", cycle: "FULL_TIME", tierKey: "TIER_1",
    offerDate: null, rounds: [], branch: null, announcedCgpaCutoff: null,
    eligibleBranches: ["CSE"],
    compensation: { ctcLpa, stipendPerMonthInr: null, firstYearCashLpa: ctcLpa },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PRIVACY_MIN_COHORT_SIZE", "5");
  database.drives.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe("company directory", () => {
  it("withholds live amounts until enough students state that amount", async () => {
    database.offers.mockResolvedValue([
      ...Array.from({ length: 4 }, () => offer(1)), offer(1, null), offer(1, null),
    ]);
    const result = await queryDirectory({ batchYear: 2027 });
    expect(result.rows[0]).toMatchObject({
      reports: 6, highestCtcLpa: null, firstYearCashLpa: null,
    });

    database.offers.mockResolvedValue(Array.from({ length: 5 }, () => offer(1)));
    expect((await queryDirectory({ batchYear: 2027 })).rows[0]?.highestCtcLpa).toBe(20);
  });

  it("clamps a page beyond the filtered results", async () => {
    database.offers.mockResolvedValue(Array.from({ length: 12 }, (_, index) => offer(index)));
    const result = await queryDirectory({ batchYear: 2027, page: 99, pageSize: 5 });
    expect(result).toMatchObject({ page: 3, pageCount: 3, total: 12 });
    expect(result.rows).toHaveLength(2);
  });

  it("counts live coverage within the search result", async () => {
    database.offers.mockResolvedValue([offer(1), offer(2), offer(3)]);
    const result = await queryDirectory({ batchYear: 2027, search: "Company 2" });
    expect(result).toMatchObject({ total: 1, reportedRows: 1 });
  });

  it("aggregates historical and student submissions together", async () => {
    database.offers.mockResolvedValue([
      ...Array.from({ length: 3 }, () => ({ ...offer(1), source: "OFFICIAL_IMPORT" })),
      offer(1), offer(1),
    ]);
    const result = await queryDirectory({ batchYear: 2026 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ reports: 5, historicalReports: 3, studentReports: 2, highestCtcLpa: 20 });
  });
});
