import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Observation } from "./observations";
import { loadObservations } from "./observations";
import { getBatchOverview, getTopRecruiters, getCompanyTrend, getCtcInflationLeaders, getSeasonEntries } from "./queries";

const database = vi.hoisted(() => ({
  findBatch: vi.fn<() => Promise<{ id: string } | null>>(),
  offers: vi.fn<() => Promise<unknown[]>>(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { batch: { findUnique: database.findBatch }, offer: { findMany: database.offers } },
}));
vi.mock("./observations", () => ({
  loadObservations: vi.fn<typeof loadObservations>(),
}));

const observation: Observation = {
  source: "SELF_REPORTED",
  offerId: "test-offer", companyId: "test-company", companyName: "Northwind Labs",
  companySlug: "northwind-labs", cycle: "FULL_TIME", nature: "FTE_ONLY",
  acceptanceStatus: "ACCEPTED", tierKey: "TIER_1", roleFamily: "SDE", roleTitle: "SDE 1",
  ctcLpa: 20, baseLpa: 15, stipendInr: null, firstYearCashLpa: 15, nonCashLpa: 5,
  branchCode: "CSE", eligibleBranches: ["CSE"], announcedCgpaCutoff: null,
  workMode: "HYBRID", bondMonths: 12, internshipDurationMonths: null,
  verification: "UNVERIFIED", date: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PRIVACY_MIN_COHORT_SIZE", "5");
  database.findBatch.mockResolvedValue({ id: "test-batch" });
});

afterEach(() => vi.unstubAllEnvs());

describe("live aggregates", () => {
  it("counts acceptance from the same filtered observations as package statistics", async () => {
    vi.mocked(loadObservations).mockResolvedValue([
      observation,
      { ...observation, acceptanceStatus: "DECLINED", nature: "PPO_CONVERTED" },
    ]);
    const filters = { batchYear: 2027, roleFamily: "SDE" as const };
    const overview = await getBatchOverview(filters);
    expect(loadObservations).toHaveBeenCalledWith(filters);
    expect(overview).toMatchObject({ reportCount: 2, accepted: 1, declined: 1, converted: 1 });
  });

  it("uses known compensation even when other reports leave it blank", async () => {
    vi.mocked(loadObservations).mockResolvedValue([
      ...Array.from({ length: 4 }, () => observation),
      ...Array.from({ length: 8 }, () => ({ ...observation, ctcLpa: null, baseLpa: null })),
    ]);
    const overview = await getBatchOverview({ batchYear: 2027 });
    expect(overview?.reportCount).toBe(12);
    expect(overview?.ctc).toMatchObject({ count: 4, highest: 20, median: 20, average: 20 });
    expect(overview?.ctcHistogram.length).toBeGreaterThan(0);
  });

  it("releases known package figures", async () => {
    vi.mocked(loadObservations).mockResolvedValue(Array.from({ length: 5 }, () => observation));
    expect((await getBatchOverview({ batchYear: 2027 }))?.ctc).toMatchObject({
      count: 5, highest: 20, median: 20, average: 20,
    });
  });

  it("shows known values for a recruiter with one outcome", async () => {
    vi.mocked(loadObservations).mockResolvedValue([
      ...Array.from({ length: 5 }, () => observation),
      { ...observation, companySlug: "small-company", ctcLpa: 80 },
    ]);
    const recruiters = await getTopRecruiters(2027);
    expect(recruiters.find((row) => row.companySlug === "small-company")).toMatchObject({
      reports: 1, highestCtc: 80, medianCtc: 80,
    });
  });

  it("includes historical submissions and keeps unknown decisions separate", async () => {
    vi.mocked(loadObservations).mockResolvedValue([
      observation,
      { ...observation, source: "OFFICIAL_IMPORT", acceptanceStatus: "UNKNOWN" },
    ]);
    expect(await getBatchOverview({ batchYear: 2026 })).toMatchObject({
      reportCount: 2, historicalCount: 1, accepted: 1, undecided: 0, unknownAcceptance: 1,
    });
  });

  it("combines historical and future offers in a single company trend row", async () => {
    const offer = {
      cycle: "FULL_TIME", announcedCgpaCutoff: 7, batch: { year: 2026 },
      compensation: { ctcLpa: 20 },
    };
    database.offers.mockResolvedValue([
      ...Array.from({ length: 4 }, () => ({ ...offer, source: "OFFICIAL_IMPORT" })),
      { ...offer, source: "SELF_REPORTED" },
    ]);
    expect(await getCompanyTrend("company-id")).toEqual([{
      key: "2026::FULL_TIME", batchYear: 2026, cycle: "FULL_TIME", offers: 5,
      highestCtc: 20, medianCtc: 20, gpaCutoff: "7.00",
      ctcRecords: 5, ctcWithheld: false, highestQuotedCtc: null,
      quotedCtcRecords: 0, quoteWithheld: false, highestStipend: null,
    }]);
  });

  it("recovers source quotes while leaving awarded CTC statistics unknown", async () => {
    const offer = {
      id: `handmade-${"a".repeat(32)}`, source: "OFFICIAL_IMPORT", studentId: null,
      processNotes: "Source: source.xlsx · Internship · row 6.",
      cycle: "SIX_MONTH_INTERNSHIP", announcedCgpaCutoff: null, batch: { year: 2027 },
      compensation: { ctcLpa: null, stipendPerMonthInr: 105000, rawNote: "Source package: monthly internship stipend 105000 INR; stated base 21 LPA; headline CTC 87 LPA.\nPerformance-based FTE." },
    };
    database.offers.mockResolvedValue(Array.from({ length: 16 }, () => offer));
    expect((await getCompanyTrend("company-id"))[0]).toMatchObject({
      highestCtc: null, medianCtc: null, ctcRecords: 0, ctcWithheld: false,
      highestQuotedCtc: 87, quotedCtcRecords: 16, quoteWithheld: false, highestStipend: 105000,
    });
    database.offers.mockResolvedValue([offer]);
    expect((await getCompanyTrend("company-id"))[0]).toMatchObject({
      highestCtc: null, highestQuotedCtc: 87, quoteWithheld: false, highestStipend: 105000,
    });
  });

  it("shows a single awarded CTC rather than treating it as missing", async () => {
    database.offers.mockResolvedValue([{ cycle: "FULL_TIME", announcedCgpaCutoff: null, batch: { year: 2027 }, compensation: { ctcLpa: 40 } }]);
    expect((await getCompanyTrend("company-id"))[0]).toMatchObject({ highestCtc: 40, ctcRecords: 1, ctcWithheld: false });
  });

  it("shows inflation analysis when one offer supplies cash pay", async () => {
    vi.mocked(loadObservations).mockResolvedValue([
      ...Array.from({ length: 5 }, () => ({ ...observation, firstYearCashLpa: null, nonCashLpa: 0 })),
      { ...observation, firstYearCashLpa: 10, nonCashLpa: 0 },
    ]);
    expect(await getCtcInflationLeaders(2027)).toMatchObject([{ firstYearCashLpa: 10, ratio: 2 }]);
  });

  it("combines season outcomes using each amount's known values", async () => {
    vi.mocked(loadObservations).mockResolvedValue([
      ...Array.from({ length: 4 }, () => observation),
      { ...observation, source: "OFFICIAL_IMPORT", ctcLpa: null, date: new Date("2026-08-01") },
      { ...observation, ctcLpa: null, stipendInr: 50_000, date: new Date("2026-09-01") },
    ]);
    expect(await getSeasonEntries(2027)).toEqual([{
      id: "test-company::FULL_TIME", date: Date.parse("2026-08-01"),
      company: { name: "Northwind Labs", slug: "northwind-labs" }, reports: 6,
      roleTitles: ["SDE 1"], tierKeys: ["TIER_1"], highestCtc: 20, highestStipend: 50000,
    }]);
  });
});
