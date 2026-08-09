import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { BATCH_YEAR, REJECTION_CASES, STUDENTS, SUBMISSIONS } from "./dataset";
import { OfferInput, createOffer } from "@/lib/offers/submit";
import { getQuotaState } from "@/lib/policy/quota";
import {
  getBatchOverview,
  getBranchBreakdown,
  getCgpaVersusPackage,
  getCtcInflationLeaders,
  getTierBreakdown,
  getTopRecruiters,
} from "@/lib/analytics/queries";
import { queryDirectory } from "@/lib/analytics/directory";

/**
 * Builds the synthetic 9999 batch and checks the analytics as it goes.
 *
 *   npm run demo:9999          build it
 *   npm run demo:9999 -- --reset   tear it down first
 *
 * Every offer is created through the SAME path a real submission takes: the
 * form's zod schema validates it, then createOffer runs — deriving the tier
 * from the package, re-checking the quota against the database, computing the
 * cash and take-home figures, flagging outliers and recomputing corroboration.
 * Nothing is inserted directly, because a fixture that bypasses the write path
 * cannot tell you the write path works.
 *
 * The one exception is the students themselves: they are provisioned through
 * the real login path, then their graduating year is set to 9999 directly,
 * because no SRN can encode a four-digit admission year. Identity provisioning
 * is already covered elsewhere; the submission path is what is under test here.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

let failures = 0;

function check(label: string, passed: boolean, detail: string) {
  if (!passed) failures += 1;
  console.log(`   ${passed ? "ok" : "FAIL"}  ${label}: ${detail}`);
}

function heading(text: string) {
  console.log(`\n${"─".repeat(74)}\n${text}\n${"─".repeat(74)}`);
}

async function reset() {
  const batch = await prisma.batch.findUnique({ where: { year: BATCH_YEAR } });
  if (!batch) return;

  const offers = await prisma.offer.findMany({
    where: { batchId: batch.id },
    select: { id: true, compensationId: true },
  });

  await prisma.report.deleteMany({ where: { offerId: { in: offers.map((o) => o.id) } } });
  await prisma.offer.deleteMany({ where: { batchId: batch.id } });
  await prisma.compensationPackage.deleteMany({
    where: { id: { in: offers.map((o) => o.compensationId).filter((id): id is string => !!id) } },
  });
  await prisma.drive.deleteMany({ where: { batchId: batch.id } });

  const students = await prisma.student.findMany({
    where: { srn: { in: STUDENTS.map((s) => s.srn) } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: students.map((s) => s.id) } } });
  await prisma.student.deleteMany({ where: { srn: { in: STUDENTS.map((s) => s.srn) } } });
  await prisma.tierConfig.deleteMany({ where: { batchId: batch.id } });
  await prisma.submissionPolicy.deleteMany({ where: { batchId: batch.id } });
  await prisma.batch.delete({ where: { id: batch.id } });

  console.log(`Removed the existing batch of ${BATCH_YEAR}.`);
}

async function provisionStudents() {
  const [branches, campuses, program] = await Promise.all([
    prisma.branch.findMany(),
    prisma.campus.findMany(),
    prisma.program.findFirst({ where: { code: "BTECH" } }),
  ]);

  const rows = [];
  for (const student of STUDENTS) {
    const branch = branches.find((b) => b.code === student.branchCode);
    const campus = campuses.find((c) => c.code === student.campusCode);

    rows.push(
      await prisma.student.upsert({
        where: { srn: student.srn },
        update: { graduationYear: BATCH_YEAR },
        create: {
          srn: student.srn,
          name: student.name,
          branchId: branch?.id ?? null,
          campusId: campus?.id ?? null,
          programId: program?.id ?? null,
          section: student.section,
          currentSemester: 8,
          graduationYear: BATCH_YEAR,
        },
      }),
    );
  }
  return rows;
}

async function main() {
  if (process.argv.includes("--reset")) await reset();

  heading(`Building the batch of ${BATCH_YEAR} from artificial form submissions`);

  // The batch is created through the same helper a first login from an unseen
  // year uses, so it inherits tier boundaries and quotas from the newest batch.
  const { ensureBatch } = await import("@/lib/policy/batch");
  const batch = await ensureBatch(BATCH_YEAR);
  const tiers = await prisma.tierConfig.findMany({
    where: { batchId: batch.id },
    orderBy: { rank: "asc" },
  });
  console.log(
    `Batch created with ${tiers.length} tiers: ` +
      tiers.map((t) => `${t.label} ${t.minCtcLpa}${t.maxCtcLpa ? `–${t.maxCtcLpa}` : "+"}`).join(", "),
  );

  const students = await provisionStudents();
  console.log(`${students.length} synthetic students provisioned.`);

  const companiesBefore = await prisma.company.count();

  // ---------------------------------------------------------------- submit
  heading("Submitting");

  const checkpoints = new Set([1, 4, 5, 12, 22, SUBMISSIONS.length]);
  let accepted = 0;
  let flagged = 0;

  for (const [index, entry] of SUBMISSIONS.entries()) {
    const student = students[entry.student];
    if (!student) throw new Error(`No student at index ${entry.student}`);

    // The exact schema the form posts through.
    const parsed = OfferInput.safeParse({ ...entry.offer, batchYear: BATCH_YEAR });
    if (!parsed.success) {
      failures += 1;
      console.log(`  FAIL  row ${index + 1} did not validate: ${parsed.error.issues[0]?.message}`);
      continue;
    }

    const result = await createOffer(student, parsed.data);
    if (!result.ok) {
      failures += 1;
      console.log(`  FAIL  row ${index + 1} (${entry.offer.companyName}) rejected: ${result.error}`);
      continue;
    }

    accepted += 1;
    if (result.flagged) flagged += 1;

    const marker = result.flagged ? " [flagged as outlier]" : "";
    console.log(
      `  ${String(accepted).padStart(2)}. ${entry.offer.companyName} — ${entry.offer.roleTitle}${marker}`,
    );

    if (checkpoints.has(accepted)) {
      await checkpoint(accepted);
    }
  }

  // ------------------------------------------------------- rules that must bite
  heading("Rules the server must enforce regardless of the form");

  for (const rejection of REJECTION_CASES) {
    const student = students[rejection.student]!;
    const parsed = OfferInput.parse({ ...rejection.offer, batchYear: BATCH_YEAR });
    const result = await createOffer(student, parsed);
    check(
      `rejects ${rejection.expects}`,
      !result.ok,
      result.ok ? "IT WAS ACCEPTED" : `"${result.error}"`,
    );
  }

  const wrongBatch = await prisma.student.findFirst({
    where: { graduationYear: { not: BATCH_YEAR }, role: "STUDENT" },
  });
  if (wrongBatch) {
    const result = await createOffer(
      wrongBatch,
      OfferInput.parse({
        batchYear: BATCH_YEAR,
        companyName: "Northwind Labs",
        roleTitle: "SDE 1",
        cycle: "FULL_TIME",
        ctcLpa: 30,
      }),
    );
    check(
      "rejects an offer filed against someone else's batch",
      !result.ok,
      result.ok ? "IT WAS ACCEPTED" : `"${result.error}"`,
    );
  }

  // ---------------------------------------------------------------- verdicts
  heading("Final state");
  await finalChecks(companiesBefore, accepted, flagged);

  console.log(
    `\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n` +
      `Open http://localhost:3000/overview?batch=${BATCH_YEAR} to see it.`,
  );
  if (failures > 0) process.exitCode = 1;
}

/** Live analytics, read the way the pages read them, part-way through loading. */
async function checkpoint(count: number) {
  const [overview, cgpa] = await Promise.all([
    getBatchOverview({ batchYear: BATCH_YEAR }),
    getCgpaVersusPackage(BATCH_YEAR),
  ]);

  console.log(`      ── after ${count} submissions ──`);
  console.log(
    `      offers ${overview?.reportCount ?? 0} · companies ${overview?.companiesReported ?? 0} · ` +
      `median CTC ${overview?.ctc.median ?? "—"}`,
  );

  // The k-anonymity floor is the one thing that must behave differently before
  // and after the threshold, so it is checked at every checkpoint.
  if (count < 5) {
    check(
      `CGPA analysis withheld at n=${count}`,
      cgpa.suppressed,
      cgpa.suppressed ? cgpa.reason.slice(0, 62) + "…" : "IT WAS REVEALED",
    );
  } else {
    check(
      `CGPA analysis available at n=${count}`,
      !cgpa.suppressed,
      cgpa.suppressed ? `still withheld: ${cgpa.reason}` : `${cgpa.value.length} points`,
    );
  }
}

async function finalChecks(companiesBefore: number, accepted: number, flagged: number) {
  const batch = await prisma.batch.findUniqueOrThrow({ where: { year: BATCH_YEAR } });

  const [overview, tierBreakdown, branches, recruiters, inflation, directory] = await Promise.all([
    getBatchOverview({ batchYear: BATCH_YEAR }),
    getTierBreakdown(BATCH_YEAR),
    getBranchBreakdown(BATCH_YEAR),
    getTopRecruiters(BATCH_YEAR, 5),
    getCtcInflationLeaders(BATCH_YEAR, 5),
    queryDirectory({ batchYear: BATCH_YEAR, sort: "ctc", direction: "desc" }),
  ]);

  console.log(`\n  Submissions accepted: ${accepted}, of which ${flagged} flagged as outliers.\n`);

  // --- company identity ---------------------------------------------------
  const companiesAfter = await prisma.company.count();
  const eternal = await prisma.company.findFirst({
    where: { aliases: { some: { normalized: "eternal" } } },
    select: { name: true },
  });
  const oracle = await prisma.company.findFirst({
    where: { aliases: { some: { normalized: "oracleofss" } } },
    select: { name: true },
  });

  check(
    "'Eternal' resolved to the imported company",
    eternal?.name === "Eternal (Zomato)",
    `matched "${eternal?.name}"`,
  );
  check(
    "'Oracle(OFSS)' resolved without creating a duplicate",
    oracle?.name === "Oracle (OFSS)",
    `matched "${oracle?.name}"`,
  );
  console.log(
    `   --  companies created by this batch: ${companiesAfter - companiesBefore} new, ` +
      `${accepted} submissions`,
  );

  // --- tier derivation ----------------------------------------------------
  const byTier = await prisma.offer.groupBy({
    by: ["tierKey"],
    where: { batchId: batch.id, deletedAt: null },
    _count: { _all: true },
  });
  const tierCounts = Object.fromEntries(byTier.map((row) => [row.tierKey ?? "none", row._count._all]));

  check(
    "tier 1 derived from packages above 12 LPA",
    (tierCounts["TIER_1"] ?? 0) > 0,
    `${tierCounts["TIER_1"] ?? 0} offers`,
  );
  check(
    "tier 2 derived from packages between 6 and 12",
    (tierCounts["TIER_2"] ?? 0) > 0,
    `${tierCounts["TIER_2"] ?? 0} offers`,
  );
  check(
    "tier 3 derived from packages below 6",
    (tierCounts["TIER_3"] ?? 0) > 0,
    `${tierCounts["TIER_3"] ?? 0} offers`,
  );
  check(
    "offers with no package carry no tier",
    (tierCounts["none"] ?? 0) > 0,
    `${tierCounts["none"] ?? 0} offers untiered (internships with no CTC)`,
  );

  // --- outlier + corroboration -------------------------------------------
  const outliers = await prisma.offer.findMany({
    where: { batchId: batch.id, isOutlierFlagged: true },
    select: { outlierNote: true, compensation: { select: { ctcLpa: true } } },
  });
  check(
    "the implausible 95 LPA report was flagged, not blocked",
    outliers.length === 1 && Number(outliers[0]?.compensation?.ctcLpa) === 95,
    outliers[0]?.outlierNote ?? "nothing flagged",
  );

  const corroborated = await prisma.offer.count({
    where: { batchId: batch.id, verification: "CORROBORATED" },
  });
  check(
    "consistent independent reports corroborate each other",
    corroborated >= 5,
    `${corroborated} offers marked corroborated`,
  );

  // --- privacy ------------------------------------------------------------
  const named = await prisma.offer.count({
    where: { batchId: batch.id, nameVisibility: "NAMED" },
  });
  const anonymous = await prisma.offer.count({
    where: { batchId: batch.id, nameVisibility: "ANONYMOUS" },
  });
  check(
    "anonymity is the default",
    anonymous > named,
    `${anonymous} anonymous, ${named} opted in to being named`,
  );

  const banded = await prisma.offer.count({
    where: { batchId: batch.id, cgpa: { not: null }, cgpaBand: null },
  });
  check("every recorded CGPA has a public band", banded === 0, `${banded} missing a band`);

  // --- derived compensation ----------------------------------------------
  const northwind = await prisma.offer.findFirst({
    where: { batchId: batch.id, company: { name: "Northwind Labs" }, cycle: "FULL_TIME" },
    include: { compensation: true },
    orderBy: { createdAt: "asc" },
  });
  const pkg = northwind?.compensation;
  check(
    "headline separated from first-year cash",
    pkg !== null && Number(pkg?.ctcLpa) === 46 && Number(pkg?.firstYearCashLpa) === 27,
    `CTC ${pkg?.ctcLpa} LPA, cash in year one ${pkg?.firstYearCashLpa} LPA ` +
      `(${Number(pkg?.ctcInflationRatio ?? 0).toFixed(2)}×)`,
  );
  check(
    "a take-home estimate was computed",
    Number(pkg?.estimatedInHandMonthlyInr ?? 0) > 0,
    `₹${Math.round(Number(pkg?.estimatedInHandMonthlyInr ?? 0)).toLocaleString("en-IN")}/month ` +
      `on ${pkg?.computedForFinancialYear} slabs`,
  );

  // --- statistics ---------------------------------------------------------
  // Every figure a page shows is one row per submission. This is the invariant
  // the whole analytics layer rests on: a batch statistic counts people who
  // filed, never a headcount a spreadsheet published.
  const filed = await prisma.offer.count({
    where: { batch: { year: BATCH_YEAR }, deletedAt: null, verification: { not: "REMOVED" } },
  });
  check(
    "batch statistics count exactly one row per submission",
    overview !== null && overview.reportCount === filed,
    `overview reports ${overview?.reportCount} against ${filed} offers on file`,
  );

  // The real test of the separation is batch 2026, which HAS imported drives
  // sitting in the same database. If any of them reached an aggregate, the
  // count would exceed what students actually filed for that year.
  const importedYear = 2026;
  const [importedOverview, filed2026, drives2026] = await Promise.all([
    getBatchOverview({ batchYear: importedYear }),
    prisma.offer.count({
      where: { batch: { year: importedYear }, deletedAt: null, verification: { not: "REMOVED" } },
    }),
    prisma.drive.count({ where: { batch: { year: importedYear } } }),
  ]);
  check(
    `imported drives stay out of batch statistics (${drives2026} drives in ${importedYear})`,
    importedOverview !== null && importedOverview.reportCount === filed2026,
    `${importedYear}: overview reports ${importedOverview?.reportCount}, ` +
      `students filed ${filed2026}, spreadsheets contributed ${drives2026} drives`,
  );

  check(
    "every branch received at least one reported offer",
    branches.every((branch) => branch.offersReported > 0),
    branches.map((branch) => `${branch.branchCode}:${branch.offersReported}`).join(" "),
  );
  check(
    "branch eligibility is answerable from submissions alone",
    branches.some((branch) => branch.companiesOpenTo > 0),
    branches
      .filter((branch) => branch.companiesOpenTo > 0)
      .map((branch) => `${branch.branchCode}:${branch.companiesOpenTo}`)
      .join(" ") || "no student reported which branches were called",
  );
  check(
    "the headline-vs-cash table found packages to compare",
    inflation.length > 0,
    inflation
      .map((row) => `${row.companyName} ${row.ratio?.toFixed(2)}×`)
      .join(", ") || "none",
  );
  check(
    "the directory returns rows and facets",
    directory.total > 0 && directory.facets.tiers.length > 0,
    `${directory.total} drives · tier facets ${directory.facets.tiers
      .map((tier) => `${tier.label}:${tier.count}`)
      .join(" ")}`,
  );

  // --- quota state --------------------------------------------------------
  const students = await prisma.student.findMany({
    where: { srn: { in: STUDENTS.map((s) => s.srn) } },
    take: 1,
    orderBy: { srn: "asc" },
  });
  if (students[0]) {
    const quota = await getQuotaState(students[0].id, BATCH_YEAR);
    check(
      "quota state reports what a student has used",
      quota !== null,
      quota?.slots.map((slot) => `${slot.label} ${slot.used}/${slot.max}`).join(", ") ?? "none",
    );
  }

  console.log("\n  Overview as the page will render it:");
  console.log(`    offers reported      ${overview?.reportCount}`);
  console.log(`    companies            ${overview?.companiesReported}`);
  console.log(`    highest CTC          ${overview?.ctc.highest} LPA`);
  console.log(`    median CTC           ${overview?.ctc.median} LPA`);
  console.log(`    mean CTC             ${overview?.ctc.average?.toFixed(2)} LPA`);
  console.log(`    median stipend       ₹${overview?.stipend.median?.toLocaleString("en-IN")}`);
  console.log(
    `    accepted / declined  ${overview?.accepted} / ${overview?.declined}`,
  );
  console.log(
    `    tiers                ${tierBreakdown
      .map((tier) => `${tier.label} ${tier.reports}`)
      .join(" · ")}`,
  );
  console.log(
    `    top recruiters       ${recruiters
      .map((row) => `${row.companyName} (${row.reports})`)
      .join(", ")}`,
  );
}

main()
  .catch((error) => {
    console.error("\nDemo build failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
