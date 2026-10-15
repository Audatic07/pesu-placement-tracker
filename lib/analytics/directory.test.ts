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
  it("shows source quotes separately and keeps awarded CTC filtering unchanged", async () => {
    const historical = {
      ...offer(1, null), id: `handmade-${"a".repeat(32)}`, source: "OFFICIAL_IMPORT", studentId: null,
      processNotes: "Source: source.xlsx · Internship · row 6.",
      compensation: { ctcLpa: null, firstYearCashLpa: null, stipendPerMonthInr: 105000,
        rawNote: "Source package: monthly internship stipend 105000 INR; stated base 21 LPA; headline CTC 87 LPA." },
    };
    database.offers.mockResolvedValue(Array.from({ length: 16 }, () => historical));
    expect((await queryDirectory({ batchYear: 2027 })).rows[0]).toMatchObject({ highestCtcLpa: null, highestQuotedCtcLpa: 87, ctcWithheld: false });
    expect((await queryDirectory({ batchYear: 2027, minCtcLpa: 80 })).rows).toEqual([]);
    database.offers.mockResolvedValue([historical]);
    expect((await queryDirectory({ batchYear: 2027 })).rows[0]).toMatchObject({ highestQuotedCtcLpa: 87, quoteWithheld: false });
  });
  it("shows every recorded amount regardless of cohort size", async () => {
    database.offers.mockResolvedValue([
      ...Array.from({ length: 4 }, () => offer(1)), offer(1, null), offer(1, null),
    ]);
    const result = await queryDirectory({ batchYear: 2027 });
    expect(result.rows[0]).toMatchObject({
      reports: 6, highestCtcLpa: 20, firstYearCashLpa: 20,
    });

    database.offers.mockResolvedValue(Array.from({ length: 5 }, () => offer(1)));
    expect((await queryDirectory({ batchYear: 2027 })).rows[0]?.highestCtcLpa).toBe(20);
    database.offers.mockResolvedValue([offer(1)]);
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
