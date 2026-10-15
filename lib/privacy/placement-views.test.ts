import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CompanyPage from "@/app/(app)/companies/[slug]/page";
import OfferPage from "@/app/(app)/offers/[id]/page";

type CompanyQuery = { include: { offers: { select: Record<string, unknown>; where: { batch: { year: { equals?: number } } }; take: number; skip: number } } };
const database = vi.hoisted(() => ({
  company: vi.fn<(query: CompanyQuery) => Promise<unknown>>(),
  offer: vi.fn<(query: { include: Record<string, unknown> }) => Promise<unknown>>(),
  trend: vi.fn<() => Promise<unknown[]>>(),
}));
vi.mock("@/lib/db", () => ({ prisma: { company: { findUnique: database.company }, offer: { findUnique: database.offer } } }));
vi.mock("@/lib/analytics/queries", () => ({ getCompanyTrend: database.trend }));
vi.mock("@/lib/auth/rbac", () => ({
  getCurrentStudent: async () => ({ id: "viewer", role: "STUDENT" }),
  requireStudent: async () => ({ id: "viewer", role: "STUDENT" }),
  roleAtLeast: () => false,
}));
vi.mock("@/app/(app)/offers/[id]/report-button", () => ({ ReportButton: () => null }));

const offer = {
  id: "offer", roleTitle: "Engineer", cycle: "FULL_TIME", nature: "FTE_ONLY",
  nameVisibility: "NAMED", verification: "ADMIN_VERIFIED", deletedAt: null,
  source: "SELF_REPORTED", studentId: "recipient", student: { name: "RECIPIENT_NAME_MUST_NOT_LEAK", srn: "RECIPIENT_SRN_MUST_NOT_LEAK" },
  company: { name: "Example Company", slug: "example" }, batch: { year: 2025 },
  compensation: { ctcLpa: 50, baseLpa: 40, rawNote: null, stipendPerMonthInr: null, components: [] },
  branch: null, cgpa: 8.63, cgpaBand: "8.50–8.75", locations: [], eligibleBranches: [],
  rounds: [], reports: [], processNotes: null, preparationResources: null,
  announcedCgpaCutoff: null, bondMonths: null, internshipDurationMonths: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  database.offer.mockResolvedValue(offer);
  database.company.mockResolvedValue({ id: "company", name: "Example Company", aliases: [], parent: null, children: [], offers: [offer] });
  database.trend.mockResolvedValue([{ key: "2025::FULL_TIME", batchYear: 2025, cycle: "FULL_TIME", offers: 1, highestCtc: 50, medianCtc: 50, ctcRecords: 1, ctcWithheld: false, highestQuotedCtc: null, quoteWithheld: false, highestStipend: null, gpaCutoff: null }]);
});

describe("anonymous placement rendering", () => {
  it("shows company compensation without fetching or rendering recipient identity", async () => {
    const html = renderToStaticMarkup(await CompanyPage({ params: Promise.resolve({ slug: "example" }), searchParams: Promise.resolve({ batch: "2025", page: "2" }) }));
    expect(html).toContain("50.0 LPA");
    expect(html).not.toContain("RECIPIENT_NAME_MUST_NOT_LEAK");
    expect(html).not.toContain("RECIPIENT_SRN_MUST_NOT_LEAK");
    const query = database.company.mock.calls[0]![0];
    expect(query.include.offers.select).not.toHaveProperty("student");
    expect(query.include.offers.where.batch.year.equals).toBe(2025);
    expect(query.include.offers).toMatchObject({ take: 26, skip: 25 });
  });

  it("shows exact placement figures but hides legacy named-offer recipients", async () => {
    const html = renderToStaticMarkup(await OfferPage({ params: Promise.resolve({ id: "offer" }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("50.0 LPA");
    expect(html).toContain("8.63");
    expect(html).toContain("Reported anonymously");
    expect(html).not.toContain("RECIPIENT_NAME_MUST_NOT_LEAK");
    expect(html).not.toContain("RECIPIENT_SRN_MUST_NOT_LEAK");
    expect(database.offer.mock.calls[0]![0].include).not.toHaveProperty("student");
  });
});
