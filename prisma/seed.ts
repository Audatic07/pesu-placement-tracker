/**
 * Seeds the configuration layer — the rows that make the rest of the system
 * work without hardcoding anything a future maintainer would have to hunt for
 * in application code.
 *
 * Safe to re-run: every write is an upsert keyed on a natural unique field.
 *
 *   npm run seed
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// ---------------------------------------------------------------------------
// Campuses — PESU auth returns campusCode 1 = RR, 2 = EC.
// ---------------------------------------------------------------------------
const CAMPUSES = [
  { code: 1, name: "RR Campus" },
  { code: 2, name: "EC Campus" },
];

// ---------------------------------------------------------------------------
// Branches — codes taken from the Branch_List tab of the 2026 workbook.
// `aliases` exist because PESU auth returns long-form branch names while the
// sheets use short codes, and both must resolve to the same row.
// ---------------------------------------------------------------------------
const BRANCHES = [
  {
    code: "CSE",
    name: "Computer Science and Engineering",
    rank: 1,
    aliases: ["Computer Science", "Computer Science and Engineering", "CS", "CSE"],
  },
  {
    code: "AIML",
    name: "Computer Science and Engineering (AI & ML)",
    rank: 2,
    aliases: [
      "Computer Science and Engineering (Artificial Intelligence and Machine Learning)",
      "AI&ML",
      "AIML",
      "CSE-AIML",
    ],
  },
  {
    code: "ECE",
    name: "Electronics and Communication Engineering",
    rank: 3,
    aliases: ["Electronics and Communication", "EC", "ECE"],
  },
  {
    code: "EEE",
    name: "Electrical and Electronics Engineering",
    rank: 4,
    aliases: ["Electrical and Electronics", "EE", "EEE"],
  },
  {
    code: "MECH",
    name: "Mechanical Engineering",
    rank: 5,
    aliases: ["Mechanical", "ME", "MECH"],
  },
  {
    code: "BT",
    name: "Biotechnology",
    rank: 6,
    aliases: ["Bio Technology", "Biotech", "BT"],
  },
];

const PROGRAMS = [
  { code: "BTECH", name: "Bachelor of Technology", aliases: ["B.Tech", "BTech", "B Tech"], durationYears: 4, totalSemesters: 8 },
  { code: "MTECH", name: "Master of Technology", aliases: ["M.Tech", "MTech", "M Tech"], durationYears: 2, totalSemesters: 4 },
  { code: "MCA", name: "Master of Computer Applications", aliases: ["MCA"], durationYears: 2, totalSemesters: 4 },
  { code: "BCA", name: "Bachelor of Computer Applications", aliases: ["BCA"], durationYears: 3, totalSemesters: 6 },
  { code: "BBA", name: "Bachelor of Business Administration", aliases: ["BBA"], durationYears: 3, totalSemesters: 6 },
];

/**
 * Tier boundaries, in LPA of CTC.
 *
 * These match the product spec: tier 1 above 12, tier 2 between 6 and 12,
 * tier 3 below 6. They deliberately live in the database rather than in code,
 * because the source workbook already shows them drifting — its own guideline
 * text defines a "Dream Tier" at 60+ and then notes it is "Applicable to 2025
 * batch only". Boundaries change; migrations should not be required when they do.
 */
const DEFAULT_TIERS = [
  { key: "TIER_1", label: "Tier 1", rank: 1, minCtcLpa: 12, maxCtcLpa: null },
  { key: "TIER_2", label: "Tier 2", rank: 2, minCtcLpa: 6, maxCtcLpa: 12 },
  { key: "TIER_3", label: "Tier 3", rank: 3, minCtcLpa: 0, maxCtcLpa: 6 },
];

/**
 * Batches. The 2026 season start comes from the source sheet, which records
 * "The process started on 01 Aug 2025"; later years follow the same cadence
 * and are adjustable from the admin console.
 */
const BATCHES = [
  {
    year: 2026,
    seasonStartsAt: new Date("2025-08-01T00:00:00Z"),
    policyNote:
      "Official PESU policy for this batch: a student may hold at most 1 internship and 2 FTE offers. " +
      "An FTE offer in tier 2 or 3 permits one further offer only in a higher tier. " +
      "An internship offer permits FTE-only offers in the next tier; a tier 1 internship permits none. " +
      "Applies to summer internship PPOs as well. Source: Overall Stats tab, Placement Scene '26.xlsx.",
  },
  { year: 2027, seasonStartsAt: new Date("2026-08-01T00:00:00Z"), policyNote: null },
  { year: 2028, seasonStartsAt: new Date("2027-08-01T00:00:00Z"), policyNote: null },
];

/**
 * Income tax configuration for the in-hand estimator.
 *
 * IMPORTANT: these are the Indian new-regime slabs introduced by the Union
 * Budget 2025 for FY 2025-26. They are seeded as a starting point and MUST be
 * reviewed against the current Finance Act before the in-hand figure is
 * presented as anything more than an estimate. The admin console can edit
 * them; nothing here is compiled into application code.
 */
const TAX_REGIMES = [
  {
    financialYear: "2025-26",
    regimeName: "new",
    slabs: [
      { upToLpa: 4, ratePercent: 0 },
      { upToLpa: 8, ratePercent: 5 },
      { upToLpa: 12, ratePercent: 10 },
      { upToLpa: 16, ratePercent: 15 },
      { upToLpa: 20, ratePercent: 20 },
      { upToLpa: 24, ratePercent: 25 },
      { upToLpa: null, ratePercent: 30 },
    ],
    standardDeductionInr: 75_000,
    cessPercent: 4,
    employeePfPercent: 12,
    professionalTaxInr: 2_400,
    rebateThresholdInr: 1_200_000,
    notes:
      "Union Budget 2025 new-regime slabs for FY 2025-26. VERIFY against the current Finance Act " +
      "before relying on the in-hand estimate. Employee PF assumed at 12% of basic; professional tax " +
      "at the Karnataka rate of Rs 200/month.",
  },
];

async function main() {
  console.log("Seeding configuration…\n");

  // --- Campuses ----------------------------------------------------------
  for (const campus of CAMPUSES) {
    await prisma.campus.upsert({
      where: { code: campus.code },
      update: { name: campus.name },
      create: campus,
    });
  }
  console.log(`  campuses           ${CAMPUSES.length}`);

  // --- Branches ----------------------------------------------------------
  for (const branch of BRANCHES) {
    await prisma.branch.upsert({
      where: { code: branch.code },
      update: { name: branch.name, rank: branch.rank, aliases: branch.aliases },
      create: branch,
    });
  }
  console.log(`  branches           ${BRANCHES.length}`);

  // --- Programs ----------------------------------------------------------
  for (const program of PROGRAMS) {
    await prisma.program.upsert({
      where: { code: program.code },
      update: {
        name: program.name,
        aliases: program.aliases,
        durationYears: program.durationYears,
        totalSemesters: program.totalSemesters,
      },
      create: program,
    });
  }
  console.log(`  programs           ${PROGRAMS.length}`);

  // --- Batches, tiers, submission policy ---------------------------------
  for (const batch of BATCHES) {
    const row = await prisma.batch.upsert({
      where: { year: batch.year },
      update: { seasonStartsAt: batch.seasonStartsAt, policyNote: batch.policyNote },
      create: {
        year: batch.year,
        seasonStartsAt: batch.seasonStartsAt,
        policyNote: batch.policyNote,
      },
    });

    for (const tier of DEFAULT_TIERS) {
      await prisma.tierConfig.upsert({
        where: { batchId_key: { batchId: row.id, key: tier.key } },
        update: {
          label: tier.label,
          rank: tier.rank,
          minCtcLpa: tier.minCtcLpa,
          maxCtcLpa: tier.maxCtcLpa,
        },
        create: {
          batchId: row.id,
          key: tier.key,
          label: tier.label,
          rank: tier.rank,
          minCtcLpa: tier.minCtcLpa,
          maxCtcLpa: tier.maxCtcLpa,
        },
      });
    }

    await prisma.submissionPolicy.upsert({
      where: { batchId: row.id },
      update: {},
      create: {
        batchId: row.id,
        maxSummerInternships: 1,
        maxSixMonthInternships: 3,
        maxFullTimePerTier: 1,
        maxFullTimeTotal: 3,
        description:
          "You may record 1 summer internship, up to 3 six-month internships, and 1 full-time offer " +
          "in each tier. These limits mirror what you are allowed to hold, so the analytics reflect " +
          "reality rather than wishlists.",
      },
    });
  }
  console.log(`  batches            ${BATCHES.length} (each with ${DEFAULT_TIERS.length} tiers + policy)`);

  // --- Tax regimes -------------------------------------------------------
  for (const regime of TAX_REGIMES) {
    await prisma.taxRegimeConfig.upsert({
      where: { financialYear: regime.financialYear },
      update: {
        slabs: regime.slabs,
        standardDeductionInr: regime.standardDeductionInr,
        cessPercent: regime.cessPercent,
        employeePfPercent: regime.employeePfPercent,
        professionalTaxInr: regime.professionalTaxInr,
        rebateThresholdInr: regime.rebateThresholdInr,
        notes: regime.notes,
      },
      create: regime,
    });
  }
  console.log(`  tax regimes        ${TAX_REGIMES.length}`);

  // --- CPI ---------------------------------------------------------------
  // Only a base year is seeded. Real index values are deliberately NOT
  // invented here: a fabricated CPI series would silently corrupt every
  // inflation-adjusted comparison. An admin enters the real series, and until
  // then the UI shows nominal figures only.
  await prisma.cpiIndex.upsert({
    where: { financialYear: "2025-26" },
    update: {},
    create: {
      financialYear: "2025-26",
      indexValue: 100,
      source: "Base year placeholder — enter the real CPI series before using inflation-adjusted views.",
    },
  });
  console.log("  cpi index          1 (base year placeholder)");

  const superAdminSrn = process.env.SUPER_ADMIN_SRN?.trim();
  console.log(
    superAdminSrn
      ? `\n  SUPER_ADMIN_SRN is set to ${superAdminSrn}; that account is promoted on first login.`
      : "\n  SUPER_ADMIN_SRN is not set. Add it to .env before your first login, or no one will have admin rights.",
  );

  console.log("\nDone.");
}

main()
  .catch((error) => {
    console.error("\nSeed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
