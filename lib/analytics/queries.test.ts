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

  it("withholds amounts even when many reports leave compensation blank", async () => {
    vi.mocked(loadObservations).mockResolvedValue([
      ...Array.from({ length: 4 }, () => observation),
      ...Array.from({ length: 8 }, () => ({ ...observation, ctcLpa: null, baseLpa: null })),
    ]);
    const overview = await getBatchOverview({ batchYear: 2027 });
    expect(overview?.reportCount).toBe(12);
    expect(overview?.ctc).toMatchObject({ count: 4, highest: null, median: null, average: null });
    expect(overview?.ctcHistogram).toEqual([]);
  });

  it("releases package figures at the configured minimum", async () => {
    vi.mocked(loadObservations).mockResolvedValue(Array.from({ length: 5 }, () => observation));
    expect((await getBatchOverview({ batchYear: 2027 }))?.ctc).toMatchObject({
      count: 5, highest: 20, median: 20, average: 20,
    });
  });

  it("applies the floor independently to each recruiter", async () => {
    vi.mocked(loadObservations).mockResolvedValue([
      ...Array.from({ length: 5 }, () => observation),
      { ...observation, companySlug: "small-company", ctcLpa: 80 },
    ]);
    const recruiters = await getTopRecruiters(2027);
    expect(recruiters.find((row) => row.companySlug === "small-company")).toMatchObject({
      reports: 1, highestCtc: null, medianCtc: null,
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
    }]);
  });

  it("withholds inflation analysis when only one offer supplies cash pay", async () => {
    vi.mocked(loadObservations).mockResolvedValue([
      ...Array.from({ length: 5 }, () => ({ ...observation, firstYearCashLpa: null, nonCashLpa: 0 })),
      { ...observation, firstYearCashLpa: 10, nonCashLpa: 0 },
    ]);
    expect(await getCtcInflationLeaders(2027)).toEqual([]);
  });

  it("combines season outcomes and gates each amount by its known values", async () => {
    vi.mocked(loadObservations).mockResolvedValue([
      ...Array.from({ length: 4 }, () => observation),
      { ...observation, source: "OFFICIAL_IMPORT", ctcLpa: null, date: new Date("2026-08-01") },
      { ...observation, ctcLpa: null, stipendInr: 50_000, date: new Date("2026-09-01") },
    ]);
    expect(await getSeasonEntries(2027)).toEqual([{
      id: "test-company::FULL_TIME", date: Date.parse("2026-08-01"),
      company: { name: "Northwind Labs", slug: "northwind-labs" }, reports: 6,
      roleTitles: ["SDE 1"], tierKeys: ["TIER_1"], highestCtc: null, highestStipend: null,
    }]);
  });
});
