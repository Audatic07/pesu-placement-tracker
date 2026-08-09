import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { BATCH_YEAR, REPORTS, STUDENTS, SUBMISSIONS } from "./dataset";
import { createOffer, parseOfferForm, type OfferInputValues } from "@/lib/offers/submit";
import { provisionStudent } from "@/lib/auth/provision";
import { fileReport } from "@/lib/moderation/reports";
import { getQuotaState } from "@/lib/policy/quota";
import {
  getAnnouncedCutoffs,
  getBatchOverview,
  getBranchBreakdown,
  getCgpaVersusPackage,
  getCtcInflationLeaders,
  getSeasonProgress,
  getTierBreakdown,
  getTopRecruiters,
} from "@/lib/analytics/queries";
import { queryDirectory } from "@/lib/analytics/directory";
import { linearRegression } from "@/lib/analytics/stats";
import type { StudentModel } from "@/generated/prisma/models";

/**
 * Builds the dummy batch of 9998 — 200 submissions from 170 students.
 *
 *   npm run demo:9998              build it
 *   npm run demo:9998 -- --reset   tear it down and rebuild
 *
 * Every submission travels the whole path a student's does, in the same order:
 *
 *   FormData  ->  parseOfferForm  ->  OfferInput (zod)  ->  createOffer
 *
 * The FormData step matters: encoding each row the way a browser posts it means
 * the blank-field-to-undefined rule, the unchecked checkbox, the comma-separated
 * locations and the parallel component arrays are all exercised rather than
 * assumed. createOffer then does what it always does: derives the
 * tier from the package, re-checks the quota against the database, computes the
 * cash and take-home figures, flags outliers, recomputes corroboration across
 * everyone who reported the same drive, and writes an audit entry.
 *
 * Reports go through fileReport for the same reason. Nothing is inserted
 * directly, because a fixture that bypasses the write path cannot tell you the
 * write path works.
 *
 * Students are the one exception, and only halfway: they are provisioned
 * through the real function a first login calls, so branch, campus, programme
 * and section resolution all run — and then their graduating year is set to
 * 9998 directly, because no SRN can encode a four-digit year.
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
  console.log(`\n${"─".repeat(78)}\n${text}\n${"─".repeat(78)}`);
}

// ---------------------------------------------------------------------------
// Encoding a submission the way the browser posts it
// ---------------------------------------------------------------------------

/**
 * Mirrors the field names in app/(app)/submit/offer-form.tsx exactly.
 *
 * Repeated inputs append rather than replace, numbers go over the wire as
 * strings, and an unchecked checkbox is absent entirely rather than "false" —
 * all three are the actual HTML form semantics, and all three are places the
 * decoder can go wrong.
 */
function toFormData(values: Omit<OfferInputValues, "batchYear">, batchYear: number): FormData {
  const form = new FormData();
  const set = (key: string, value: string | number | undefined | null) => {
    if (value === undefined || value === null) return;
    form.set(key, String(value));
  };

  set("batchYear", batchYear);
  set("companyName", values.companyName);
  set("roleTitle", values.roleTitle);
  set("roleFamily", values.roleFamily);
  set("cycle", values.cycle);
  set("nature", values.nature);

  set("ctcLpa", values.ctcLpa);
  set("baseLpa", values.baseLpa);
  set("stipendPerMonthInr", values.stipendPerMonthInr);

  for (const component of values.components) {
    form.append("componentKind", component.kind);
    form.append("componentAmount", String(component.amountLpa));
    form.append("componentOneTime", component.isOneTime ? "true" : "false");
  }

  set("cgpa", values.cgpa);
  set("backlogsAtOffer", values.backlogsAtOffer);
  set("priorInternshipCount", values.priorInternshipCount);

  set("locations", values.locations.join(", "));
  set("workMode", values.workMode);
  set("bondMonths", values.bondMonths);
  set("internshipDurationMonths", values.internshipDurationMonths);
  set("announcedCgpaCutoff", values.announcedCgpaCutoff);
  for (const branch of values.eligibleBranches) form.append("eligibleBranches", branch);

  set("offerDate", values.offerDate);
  set("acceptanceStatus", values.acceptanceStatus);
  set("processNotes", values.processNotes);
  set("preparationResources", values.preparationResources);
  set("difficultyRating", values.difficultyRating);

  // A checkbox that is not ticked does not appear in the payload at all.
  if (values.showName) form.set("showName", "on");

  for (const round of values.rounds) {
    form.append("roundKind", round.kind);
    form.append("roundMode", round.mode);
    form.append("roundDifficulty", round.difficulty === undefined ? "" : String(round.difficulty));
    form.append("roundTopics", round.topics ?? "");
    form.append("roundHeldOn", round.heldOn ?? "");
  }

  return form;
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

async function reset() {
  const batch = await prisma.batch.findUnique({ where: { year: BATCH_YEAR } });
  const students = await prisma.student.findMany({
    where: { srn: { in: STUDENTS.map((student) => student.srn) } },
    select: { id: true },
  });
  const studentIds = students.map((student) => student.id);

  if (batch) {
    const offers = await prisma.offer.findMany({
      where: { batchId: batch.id },
      select: { id: true, compensationId: true },
    });

    await prisma.report.deleteMany({ where: { offerId: { in: offers.map((o) => o.id) } } });
    await prisma.offer.deleteMany({ where: { batchId: batch.id } });
    await prisma.compensationPackage.deleteMany({
      where: {
        id: { in: offers.map((o) => o.compensationId).filter((id): id is string => id !== null) },
      },
    });
    await prisma.drive.deleteMany({ where: { batchId: batch.id } });
  }

  if (studentIds.length > 0) {
    await prisma.report.deleteMany({ where: { reporterId: { in: studentIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: studentIds } } });
    // Rate-limit keys are per student id, and the ids change when the rows are
    // recreated. Leaving them behind would accumulate dead buckets on every run.
    await prisma.rateLimitBucket.deleteMany({
      where: {
        OR: [
          { key: { in: studentIds.map((id) => `submit:${id}`) } },
          { key: { in: studentIds.map((id) => `report:${id}`) } },
        ],
      },
    });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
  }

  if (batch) {
    await prisma.tierConfig.deleteMany({ where: { batchId: batch.id } });
    await prisma.submissionPolicy.deleteMany({ where: { batchId: batch.id } });
    await prisma.batch.delete({ where: { id: batch.id } });
  }

  console.log(`Removed the existing batch of ${BATCH_YEAR} and its ${studentIds.length} students.`);
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

async function provisionStudents(): Promise<StudentModel[]> {
  const branches = await prisma.branch.findMany();
  const rows: StudentModel[] = [];

  for (const student of STUDENTS) {
    const branch = branches.find((row) => row.code === student.branchCode);

    // The same shape pesu-auth returns for a real profile, so branch, campus,
    // programme and section all resolve through the real code path.
    const provisioned = await provisionStudent(
      {
        srn: student.srn,
        name: student.name,
        program: "B.Tech",
        branch: branch?.name ?? student.branchCode,
        semester: student.semester,
        section: student.section,
        campusCode: student.campusCode,
        email: `${student.srn.toLowerCase()}@demo.invalid`,
      },
      null,
    );

    // The SRN encodes a two-digit admission year, so it cannot express 9998.
    rows.push(
      await prisma.student.update({
        where: { id: provisioned.id },
        data: { graduationYear: BATCH_YEAR },
      }),
    );
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  if (process.argv.includes("--reset")) await reset();

  const existing = await prisma.batch.findUnique({ where: { year: BATCH_YEAR } });
  if (existing) {
    const count = await prisma.offer.count({ where: { batchId: existing.id } });
    if (count > 0) {
      console.log(
        `The batch of ${BATCH_YEAR} already holds ${count} offers.\n` +
          `Run "npm run demo:9998 -- --reset" to rebuild it from scratch.`,
      );
      return;
    }
  }

  heading(`Building the dummy batch of ${BATCH_YEAR} from ${SUBMISSIONS.length} form submissions`);

  const { ensureBatch } = await import("@/lib/policy/batch");
  const batch = await ensureBatch(BATCH_YEAR);
  const tiers = await prisma.tierConfig.findMany({
    where: { batchId: batch.id },
    orderBy: { rank: "asc" },
  });
  console.log(
    `Batch created with ${tiers.length} tiers: ` +
      tiers
        .map((tier) => `${tier.label} ${tier.minCtcLpa}${tier.maxCtcLpa ? `–${tier.maxCtcLpa}` : "+"}`)
        .join(", "),
  );

  const students = await provisionStudents();
  console.log(`${students.length} students provisioned through the login path.`);

  const companiesBefore = await prisma.company.count();

  // ------------------------------------------------------------- submitting
  heading("Submitting");

  let accepted = 0;
  let flagged = 0;
  const offerIds: string[] = [];
  const rejections: string[] = [];

  for (const [index, entry] of SUBMISSIONS.entries()) {
    const student = students[entry.student];
    if (!student) throw new Error(`No student at index ${entry.student}`);

    const parsed = parseOfferForm(toFormData(entry.offer, BATCH_YEAR));
    if (!parsed.success) {
      failures += 1;
      offerIds.push("");
      rejections.push(
        `row ${index + 1} (${entry.offer.companyName}) did not validate: ` +
          `${parsed.error.issues[0]?.path.join(".")} — ${parsed.error.issues[0]?.message}`,
      );
      continue;
    }

    const result = await createOffer(student, parsed.data);
    if (!result.ok) {
      failures += 1;
      offerIds.push("");
      rejections.push(`row ${index + 1} (${entry.offer.companyName}) rejected: ${result.error}`);
      continue;
    }

    accepted += 1;
    if (result.flagged) flagged += 1;
    offerIds.push(result.offerId);

    if (accepted % 25 === 0 || accepted === SUBMISSIONS.length) {
      const overview = await getBatchOverview({ batchYear: BATCH_YEAR });
      console.log(
        `  ${String(accepted).padStart(3)} submitted  ·  ` +
          `${overview?.companiesReported ?? 0} companies  ·  ` +
          `median CTC ${overview?.ctc.median ?? "—"} LPA  ·  ` +
          `${flagged} flagged`,
      );
    }
  }

  for (const rejection of rejections) console.log(`  FAIL  ${rejection}`);

  // ---------------------------------------------------------------- reports
  heading("Reporting");

  let reportsFiled = 0;
  for (const report of REPORTS) {
    const reporter = students[report.reporter];
    const offerId = offerIds[report.submission];
    if (!reporter || !offerId) continue;

    const result = await fileReport(reporter, offerId, report.reason, report.details);
    if (result.ok) reportsFiled += 1;
    else console.log(`  FAIL  report on submission ${report.submission}: ${result.error}`);
  }
  console.log(`  ${reportsFiled} of ${REPORTS.length} reports filed.`);

  // ----------------------------------------------------------------- checks
  heading("Checks");
  await verify(companiesBefore, accepted, flagged, reportsFiled, offerIds);

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\n${failures === 0 ? "All checks passed" : `${failures} check(s) FAILED`} in ${seconds}s.\n` +
      `Open http://localhost:3000/overview?batch=${BATCH_YEAR} to see it.`,
  );
  if (failures > 0) process.exitCode = 1;
}

async function verify(
  companiesBefore: number,
  accepted: number,
  flagged: number,
  reportsFiled: number,
  offerIds: string[],
) {
  const batch = await prisma.batch.findUniqueOrThrow({ where: { year: BATCH_YEAR } });

  const [overview, tierBreakdown, branches, recruiters, inflation, cutoffs, cgpa, season, directory] =
    await Promise.all([
      getBatchOverview({ batchYear: BATCH_YEAR }),
      getTierBreakdown(BATCH_YEAR),
      getBranchBreakdown(BATCH_YEAR),
      getTopRecruiters(BATCH_YEAR, 8),
      getCtcInflationLeaders(BATCH_YEAR, 8),
      getAnnouncedCutoffs(BATCH_YEAR),
      getCgpaVersusPackage(BATCH_YEAR),
      getSeasonProgress(BATCH_YEAR),
      queryDirectory({ batchYear: BATCH_YEAR, sort: "ctc", direction: "desc" }),
    ]);

  // --- the submission pipeline itself -------------------------------------
  check(
    "every generated submission was accepted",
    accepted === SUBMISSIONS.length,
    `${accepted} of ${SUBMISSIONS.length}`,
  );

  const distinctStudents = await prisma.offer.findMany({
    where: { batchId: batch.id },
    select: { studentId: true },
    distinct: ["studentId"],
  });
  check(
    "every student filed at least once",
    distinctStudents.length === STUDENTS.length,
    `${distinctStudents.length} of ${STUDENTS.length} students have an offer on file`,
  );

  // --- company identity ---------------------------------------------------
  const companiesAfter = await prisma.company.count();
  const messy = ["Cobalt Systems", "Northwind Labs", "Pinegrove Services", "Umberfield IT Services"];
  const duplicates: string[] = [];
  for (const name of messy) {
    const rows = await prisma.company.findMany({
      where: { name: { contains: name.split(" ")[0]!, mode: "insensitive" } },
      select: { name: true },
    });
    if (rows.length !== 1) duplicates.push(`${name} -> ${rows.map((r) => r.name).join(" / ")}`);
  }
  check(
    "messy spellings resolved to one company each",
    duplicates.length === 0,
    duplicates.length === 0
      ? `${messy.length} companies typed several ways, ${companiesAfter - companiesBefore} rows created in total`
      : duplicates.join("; "),
  );

  // --- tier derivation ----------------------------------------------------
  const byTier = await prisma.offer.groupBy({
    by: ["tierKey"],
    where: { batchId: batch.id, deletedAt: null },
    _count: { _all: true },
  });
  const tierCounts = Object.fromEntries(
    byTier.map((row) => [row.tierKey ?? "none", row._count._all]),
  );
  check(
    "all three tiers were derived from the packages",
    (tierCounts["TIER_1"] ?? 0) > 0 &&
      (tierCounts["TIER_2"] ?? 0) > 0 &&
      (tierCounts["TIER_3"] ?? 0) > 0,
    `T1 ${tierCounts["TIER_1"] ?? 0} · T2 ${tierCounts["TIER_2"] ?? 0} · T3 ${tierCounts["TIER_3"] ?? 0}`,
  );
  check(
    "the pyramid is not top-heavy",
    (tierCounts["TIER_1"] ?? 0) < (tierCounts["TIER_2"] ?? 0),
    `tier 1 is ${(((tierCounts["TIER_1"] ?? 0) / accepted) * 100).toFixed(0)}% of submissions`,
  );
  check(
    "offers with no package carry no tier",
    (tierCounts["none"] ?? 0) > 0,
    `${tierCounts["none"] ?? 0} untiered (internships and undisclosed full-time offers)`,
  );

  // --- outliers and corroboration -----------------------------------------
  const outliers = await prisma.offer.findMany({
    where: { batchId: batch.id, isOutlierFlagged: true },
    select: { outlierNote: true, compensation: { select: { ctcLpa: true } } },
  });
  check(
    "both implausible packages were flagged, neither was blocked",
    outliers.length === 2 && flagged === 2,
    outliers.map((o) => `${o.compensation?.ctcLpa} LPA`).join(", ") || "nothing flagged",
  );

  const corroborated = await prisma.offer.count({
    where: { batchId: batch.id, verification: "CORROBORATED" },
  });
  check(
    "consistent independent reports corroborate each other",
    corroborated > accepted * 0.3,
    `${corroborated} of ${accepted} offers corroborated`,
  );

  // --- privacy ------------------------------------------------------------
  const named = await prisma.offer.count({
    where: { batchId: batch.id, nameVisibility: "NAMED" },
  });
  check(
    "anonymity is the default",
    named < accepted / 2,
    `${accepted - named} anonymous, ${named} opted in to being named`,
  );

  const unbanded = await prisma.offer.count({
    where: { batchId: batch.id, cgpa: { not: null }, cgpaBand: null },
  });
  check("every recorded CGPA has a public band", unbanded === 0, `${unbanded} missing a band`);

  check(
    `the CGPA scatter is released at n=${accepted}`,
    !cgpa.suppressed,
    cgpa.suppressed ? `withheld: ${cgpa.reason}` : `${cgpa.value.length} points`,
  );

  if (!cgpa.suppressed) {
    const fit = linearRegression(cgpa.value.map((point) => ({ x: point.cgpa, y: point.ctcLpa })));
    check(
      "CGPA predicts package with real noise, not perfectly",
      fit !== null && fit.rSquared > 0.05 && fit.rSquared < 0.95,
      fit ? `r² = ${fit.rSquared.toFixed(3)}, slope ${fit.slope.toFixed(2)} LPA per point` : "no fit",
    );
  }

  // --- derived compensation ------------------------------------------------
  const withCash = await prisma.compensationPackage.count({
    where: {
      ctcLpa: { not: null },
      estimatedInHandMonthlyInr: { not: null },
      offer: { batchId: batch.id },
    },
  });
  const withCtc = await prisma.offer.count({
    where: { batchId: batch.id, compensation: { ctcLpa: { not: null } } },
  });
  check(
    "every disclosed package got a take-home estimate",
    withCash === withCtc,
    `${withCash} of ${withCtc} packages carry an in-hand figure`,
  );
  check(
    "the headline-versus-cash table found packages to separate",
    inflation.length > 0 && inflation.some((row) => (row.ratio ?? 1) > 1.2),
    inflation
      .slice(0, 3)
      .map((row) => `${row.companyName} ${row.ratio?.toFixed(2)}×`)
      .join(", ") || "none",
  );

  // --- statistics ----------------------------------------------------------
  const filed = await prisma.offer.count({
    where: { batch: { year: BATCH_YEAR }, deletedAt: null, verification: { not: "REMOVED" } },
  });
  check(
    "batch statistics count exactly one row per submission",
    overview !== null && overview.reportCount === filed,
    `overview reports ${overview?.reportCount} against ${filed} offers on file`,
  );
  check(
    "every branch received at least one reported offer",
    branches.every((branch) => branch.offersReported > 0),
    branches.map((branch) => `${branch.branchCode}:${branch.offersReported}`).join(" "),
  );
  check(
    "branch eligibility is answerable from submissions alone",
    branches.every((branch) => branch.companiesOpenTo > 0),
    branches.map((branch) => `${branch.branchCode}:${branch.companiesOpenTo}`).join(" "),
  );
  check(
    "announced cutoffs were reconciled across disagreeing reports",
    cutoffs.length > 0,
    `${cutoffs.length} companies with a median announced cutoff`,
  );
  check(
    "the season has a shape to plot",
    season.length === filed && season[season.length - 1]!.dayOffset > 0,
    `${season.length} dated points spanning ${season[season.length - 1]?.dayOffset} days`,
  );
  check(
    "the directory returns rows and facets",
    directory.total > 0 && directory.facets.tiers.length > 0,
    `${directory.total} drives · tier facets ${directory.facets.tiers
      .map((tier) => `${tier.label}:${tier.count}`)
      .join(" ")}`,
  );

  // --- the report pipeline -------------------------------------------------
  const reportRows = await prisma.report.count({
    where: { offer: { batchId: batch.id } },
  });
  check(
    "reports were filed through the moderation path",
    reportRows === reportsFiled && reportsFiled === REPORTS.length,
    `${reportRows} reports on the queue`,
  );

  const disputed = await prisma.offer.count({
    where: { batchId: batch.id, verification: "DISPUTED" },
  });
  check(
    "two independent reports on one offer marked it disputed",
    disputed >= 1,
    `${disputed} offer(s) disputed`,
  );

  const selfReport = await prisma.offer.findFirst({
    where: { batchId: batch.id },
    select: { id: true, student: true },
  });
  if (selfReport?.student) {
    const refused = await fileReport(
      selfReport.student,
      selfReport.id,
      "OTHER",
      "Reporting my own entry.",
    );
    check(
      "reporting your own entry is refused",
      !refused.ok,
      refused.ok ? "IT WAS ACCEPTED" : `"${refused.error}"`,
    );
  }

  // --- quota ---------------------------------------------------------------
  const busiest = await prisma.offer.groupBy({
    by: ["studentId"],
    where: { batchId: batch.id },
    _count: { _all: true },
    orderBy: { _count: { studentId: "desc" } },
    take: 1,
  });
  const busiestStudentId = busiest[0]?.studentId ?? null;
  if (busiestStudentId) {
    const quota = await getQuotaState(busiestStudentId, BATCH_YEAR);
    check(
      "quota state reports what the busiest student has used",
      quota !== null,
      quota?.slots
        .map(
          (slot) =>
            `${slot.label} ${slot.used}/${slot.max}` +
            (slot.perTier
              ? ` (${slot.perTier.map((tier) => `${tier.label} ${tier.used}/${tier.max}`).join(", ")})`
              : ""),
        )
        .join(" · ") ?? "none",
    );
  }

  const quotaBlocked = await (async () => {
    const student = await prisma.student.findFirst({
      where: { offers: { some: { batchId: batch.id, cycle: "SUMMER_INTERNSHIP" } } },
    });
    if (!student) return null;
    const form = toFormData(
      {
        ...SUBMISSIONS.find((entry) => entry.offer.cycle === "SUMMER_INTERNSHIP")!.offer,
        companyName: "Windrose Staffing",
      },
      BATCH_YEAR,
    );
    const parsed = parseOfferForm(form);
    if (!parsed.success) return null;
    return createOffer(student, parsed.data);
  })();
  if (quotaBlocked) {
    check(
      "a second summer internship is still refused at volume",
      !quotaBlocked.ok,
      quotaBlocked.ok ? "IT WAS ACCEPTED" : `"${quotaBlocked.error}"`,
    );
  }

  // The per-tier cap is a separate rule from the per-cycle total: a student may
  // hold three full-time offers, but not two in the same tier. Filed against
  // someone who already holds a tier 1 offer, using a company in that tier.
  const tierBlocked = await (async () => {
    const holder = await prisma.offer.findFirst({
      where: { batchId: batch.id, cycle: "FULL_TIME", tierKey: "TIER_1" },
      select: { student: true },
    });
    if (!holder?.student) return null;
    const parsed = parseOfferForm(
      toFormData(
        {
          ...SUBMISSIONS.find(
            (entry) => entry.offer.cycle === "FULL_TIME" && (entry.offer.ctcLpa ?? 0) >= 12,
          )!.offer,
          companyName: "Silverpine Systems",
        },
        BATCH_YEAR,
      ),
    );
    if (!parsed.success) return null;
    return createOffer(holder.student, parsed.data);
  })();
  if (tierBlocked) {
    check(
      "a second full-time offer in a tier already held is refused",
      !tierBlocked.ok,
      tierBlocked.ok ? "IT WAS ACCEPTED" : `"${tierBlocked.error}"`,
    );
  }

  // A student may only file against their own batch. The form posts a batch
  // year, so this cannot be enforced by hiding a field — it is checked against
  // the student's own graduating year inside createOffer.
  const foreign = await prisma.student.findFirst({
    where: { graduationYear: { not: BATCH_YEAR }, role: "STUDENT" },
  });
  if (foreign) {
    const parsed = parseOfferForm(
      toFormData(
        { ...SUBMISSIONS[0]!.offer, companyName: "Northwind Labs" },
        BATCH_YEAR,
      ),
    );
    if (parsed.success) {
      const result = await createOffer(foreign, parsed.data);
      check(
        "an offer filed against someone else's batch is refused",
        !result.ok,
        result.ok ? "IT WAS ACCEPTED" : `"${result.error}"`,
      );
    }
  }

  // --- separation from imported history ------------------------------------
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
    importedOverview === null || importedOverview.reportCount === filed2026,
    `${importedYear}: overview reports ${importedOverview?.reportCount ?? "—"}, ` +
      `students filed ${filed2026}, spreadsheets contributed ${drives2026} drives`,
  );

  // --- what the pages will show --------------------------------------------
  console.log("\n  Overview as the page will render it:");
  console.log(`    offers reported      ${overview?.reportCount}`);
  console.log(`    students             ${STUDENTS.length}`);
  console.log(`    companies            ${overview?.companiesReported}`);
  console.log(`    highest CTC          ${overview?.ctc.highest} LPA`);
  console.log(`    median CTC           ${overview?.ctc.median} LPA`);
  console.log(`    mean CTC             ${overview?.ctc.average?.toFixed(2)} LPA`);
  console.log(`    25th–75th CTC        ${overview?.ctc.p25}–${overview?.ctc.p75} LPA`);
  console.log(`    median stipend       ₹${overview?.stipend.median?.toLocaleString("en-IN")}`);
  console.log(`    accepted / declined  ${overview?.accepted} / ${overview?.declined}`);
  console.log(
    `    tiers                ${tierBreakdown
      .map((tier) => `${tier.label} ${tier.reports}`)
      .join(" · ")}`,
  );
  console.log(
    `    top recruiters       ${recruiters
      .slice(0, 5)
      .map((row) => `${row.companyName} (${row.reports})`)
      .join(", ")}`,
  );
  console.log(
    `    histogram            ${overview?.ctcHistogram
      .map((bucket) => `${bucket.lower}-${bucket.upper}:${bucket.count}`)
      .join(" ")}`,
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
