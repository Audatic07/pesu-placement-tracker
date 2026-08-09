import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { checkQuota } from "@/lib/policy/quota";
import { resolveTierKey } from "@/lib/policy/batch";
import { cgpaBand } from "@/lib/privacy/gate";
import { deriveCompensation, type TaxRegime } from "@/lib/comp/model";
import { consumeRateLimit } from "@/lib/rate-limit";
import { normalizeCompanyName, slugify } from "@/lib/companies/name";
import type { StudentModel } from "@/generated/prisma/models";

/**
 * Creating a student-submitted offer.
 *
 * Everything a student can influence is validated here rather than trusted from
 * the form: the tier is derived from the package they entered, the quota is
 * re-checked against the database, and the CGPA band is computed rather than
 * accepted. A form field is a suggestion; this file is the rule.
 */

export const RoundInput = z.object({
  kind: z.enum([
    "PRE_PLACEMENT_TALK",
    "RESUME_SHORTLIST",
    "ONLINE_ASSESSMENT",
    "GROUP_DISCUSSION",
    "TAKE_HOME_ASSIGNMENT",
    "HACKATHON",
    "TECHNICAL_INTERVIEW",
    "SYSTEM_DESIGN",
    "MANAGERIAL",
    "HIRING_MANAGER",
    "HR",
    "OTHER",
  ]),
  mode: z.enum(["ONLINE", "IN_PERSON", "HYBRID", "UNKNOWN"]).default("UNKNOWN"),
  heldOn: z.string().optional(),
  platform: z.string().max(80).optional(),
  topics: z.string().max(300).optional(),
  difficulty: z.coerce.number().int().min(1).max(5).optional(),
  questionsAsked: z.string().max(4000).optional(),
});

export const ComponentInput = z.object({
  kind: z.enum([
    "FIXED_BASE",
    "VARIABLE_PAY",
    "JOINING_BONUS",
    "RETENTION_BONUS",
    "RELOCATION",
    "ESOP",
    "RSU",
    "GRATUITY",
    "PROVIDENT_FUND",
    "INSURANCE",
    "PERKS",
    "OTHER",
  ]),
  amountLpa: z.coerce.number().min(0).max(1000),
  isOneTime: z.coerce.boolean().default(false),
  note: z.string().max(200).optional(),
});

export const OfferInput = z.object({
  batchYear: z.coerce.number().int().min(2000).max(9999),
  companyName: z.string().trim().min(1, "Which company?").max(160),
  roleTitle: z.string().trim().min(1, "What was the role called?").max(160),
  roleFamily: z
    .enum([
      "SDE",
      "DATA_SCIENCE",
      "DATA_ENGINEERING",
      "ANALYST",
      "QA_SDET",
      "DEVOPS_SRE",
      "EMBEDDED_HARDWARE",
      "CYBERSECURITY",
      "PRODUCT",
      "CONSULTING",
      "RESEARCH",
      "NON_TECH",
      "OTHER",
    ])
    .default("OTHER"),
  cycle: z.enum(["SUMMER_INTERNSHIP", "SIX_MONTH_INTERNSHIP", "FULL_TIME"]),
  nature: z
    .enum(["INTERNSHIP_ONLY", "FTE_ONLY", "INTERNSHIP_PLUS_FTE", "PPO_CONVERTED"])
    .default("FTE_ONLY"),

  ctcLpa: z.coerce.number().min(0).max(1000).optional(),
  baseLpa: z.coerce.number().min(0).max(1000).optional(),
  stipendPerMonthInr: z.coerce.number().min(0).max(1_000_000).optional(),
  components: z.array(ComponentInput).max(12).default([]),

  cgpa: z.coerce.number().min(0).max(10).optional(),
  backlogsAtOffer: z.coerce.number().int().min(0).max(50).optional(),
  priorInternshipCount: z.coerce.number().int().min(0).max(20).optional(),

  locations: z.array(z.string().max(60)).max(6).default([]),
  workMode: z.enum(["ONSITE", "HYBRID", "REMOTE", "UNKNOWN"]).default("UNKNOWN"),
  bondMonths: z.coerce.number().int().min(0).max(120).optional(),
  internshipDurationMonths: z.coerce.number().int().min(0).max(36).optional(),

  /** What the company asked for, not what this student had. */
  announcedCgpaCutoff: z.coerce.number().min(0).max(10).optional(),
  eligibleBranches: z.array(z.string().max(12)).max(30).default([]),

  offerDate: z.string().optional(),
  acceptanceStatus: z.enum(["ACCEPTED", "DECLINED", "PENDING", "REVOKED"]).default("PENDING"),

  processNotes: z.string().max(8000).optional(),
  preparationResources: z.string().max(4000).optional(),
  difficultyRating: z.coerce.number().int().min(1).max(5).optional(),

  /** Default anonymous. Showing a name is an explicit, deliberate act. */
  showName: z.coerce.boolean().default(false),

  rounds: z.array(RoundInput).max(12).default([]),
});

export type OfferInputValues = z.infer<typeof OfferInput>;

function numberOrUndefined(value: FormDataEntryValue | null): number | undefined {
  if (value === null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Decodes the submission form's wire format into validated input.
 *
 * It lives beside the schema rather than inside the server action so that
 * anything driving a submission — the form, a script, a test — goes through the
 * same decoding and not merely the same validator. The decoding is where the
 * quiet bugs live: a blank numeric field arrives as "" and must become
 * `undefined` rather than 0, an unchecked checkbox does not arrive at all, and
 * repeated fields arrive as parallel arrays that have to be zipped back into
 * objects. A fixture that skips this step cannot tell you it works.
 */
export function parseOfferForm(formData: FormData) {
  const componentKinds = formData.getAll("componentKind").map(String);
  const componentAmounts = formData.getAll("componentAmount").map(String);
  const componentOneTime = formData.getAll("componentOneTime").map(String);

  const components = componentKinds
    .map((kind, index) => ({
      kind,
      amountLpa: componentAmounts[index] ?? "",
      isOneTime: componentOneTime[index] === "true",
    }))
    .filter((component) => component.kind && component.amountLpa !== "");

  const roundKinds = formData.getAll("roundKind").map(String);
  const roundModes = formData.getAll("roundMode").map(String);
  const roundDifficulty = formData.getAll("roundDifficulty").map(String);
  const roundTopics = formData.getAll("roundTopics").map(String);
  const roundHeldOn = formData.getAll("roundHeldOn").map(String);

  const rounds = roundKinds
    .map((kind, index) => ({
      kind,
      mode: roundModes[index] || "UNKNOWN",
      difficulty: roundDifficulty[index] || undefined,
      topics: roundTopics[index] || undefined,
      heldOn: roundHeldOn[index] || undefined,
    }))
    .filter((round) => round.kind);

  return OfferInput.safeParse({
    batchYear: formData.get("batchYear"),
    companyName: formData.get("companyName"),
    roleTitle: formData.get("roleTitle"),
    roleFamily: formData.get("roleFamily") || "OTHER",
    cycle: formData.get("cycle"),
    nature: formData.get("nature") || "FTE_ONLY",
    ctcLpa: numberOrUndefined(formData.get("ctcLpa")),
    baseLpa: numberOrUndefined(formData.get("baseLpa")),
    stipendPerMonthInr: numberOrUndefined(formData.get("stipendPerMonthInr")),
    components,
    cgpa: numberOrUndefined(formData.get("cgpa")),
    backlogsAtOffer: numberOrUndefined(formData.get("backlogsAtOffer")),
    priorInternshipCount: numberOrUndefined(formData.get("priorInternshipCount")),
    locations: String(formData.get("locations") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 6),
    workMode: formData.get("workMode") || "UNKNOWN",
    bondMonths: numberOrUndefined(formData.get("bondMonths")),
    internshipDurationMonths: numberOrUndefined(formData.get("internshipDurationMonths")),
    announcedCgpaCutoff: numberOrUndefined(formData.get("announcedCgpaCutoff")),
    eligibleBranches: formData.getAll("eligibleBranches").map(String).filter(Boolean),
    offerDate: formData.get("offerDate") || undefined,
    acceptanceStatus: formData.get("acceptanceStatus") || "PENDING",
    processNotes: formData.get("processNotes") || undefined,
    preparationResources: formData.get("preparationResources") || undefined,
    difficultyRating: numberOrUndefined(formData.get("difficultyRating")),
    showName: formData.get("showName") === "on",
    rounds,
  });
}

export type SubmitResult =
  | { ok: true; offerId: string; flagged: boolean }
  | { ok: false; error: string; field?: string };

/**
 * Resolves a typed company name to a company row, creating one only when no
 * existing name or alias matches. Free-text entry is how the source sheets
 * ended up with four spellings of IBM; matching against every recorded alias
 * first is what stops that happening again.
 */
async function resolveCompany(rawName: string): Promise<{ id: string; created: boolean }> {
  const name = rawName.trim();
  const normalized = normalizeCompanyName(name);

  const alias = await prisma.companyAlias.findUnique({
    where: { normalized },
    select: { companyId: true },
  });
  if (alias) return { id: alias.companyId, created: false };

  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const exact = companies.find((company) => normalizeCompanyName(company.name) === normalized);
  if (exact) {
    await prisma.companyAlias.create({
      data: { companyId: exact.id, alias: name, normalized },
    });
    return { id: exact.id, created: false };
  }

  let slug = slugify(name) || "company";
  let suffix = 2;
  while (await prisma.company.findUnique({ where: { slug } })) {
    slug = `${slugify(name)}-${suffix++}`;
  }

  const created = await prisma.company.create({
    data: { name, slug, aliases: { create: [{ alias: name, normalized }] } },
  });
  return { id: created.id, created: true };
}

async function loadTaxRegime(): Promise<TaxRegime | null> {
  const row = await prisma.taxRegimeConfig.findFirst({ orderBy: { financialYear: "desc" } });
  if (!row) return null;

  const slabs = (Array.isArray(row.slabs) ? row.slabs : [])
    .map((slab) => {
      const record = slab as Record<string, unknown>;
      const rate = record["ratePercent"];
      if (typeof rate !== "number") return null;
      const upTo = record["upToLpa"];
      return { upToLpa: typeof upTo === "number" ? upTo : null, ratePercent: rate };
    })
    .filter((slab): slab is { upToLpa: number | null; ratePercent: number } => slab !== null);

  if (slabs.length === 0) return null;

  return {
    financialYear: row.financialYear,
    slabs,
    standardDeductionInr: Number(row.standardDeductionInr),
    cessPercent: Number(row.cessPercent),
    employeePfPercent: Number(row.employeePfPercent),
    professionalTaxInr: Number(row.professionalTaxInr),
    rebateThresholdInr: row.rebateThresholdInr === null ? null : Number(row.rebateThresholdInr),
  };
}

/**
 * Flags a package that diverges sharply from what others reported for the same
 * company and cycle. It NEVER blocks: a genuine outlier is exactly the kind of
 * offer students most want to see, and silently refusing it would teach people
 * to round their numbers toward the crowd.
 */
async function detectOutlier(
  companyId: string,
  batchId: string,
  cycle: string,
  ctcLpa: number | null,
): Promise<string | null> {
  if (ctcLpa === null) return null;

  const peers = await prisma.offer.findMany({
    where: {
      companyId,
      batchId,
      cycle: cycle as never,
      deletedAt: null,
      verification: { notIn: ["DISPUTED", "REMOVED"] },
      compensation: { ctcLpa: { not: null } },
    },
    select: { compensation: { select: { ctcLpa: true } } },
  });

  if (peers.length < 3) return null;

  const values = peers.map((peer) => Number(peer.compensation!.ctcLpa)).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0 ? ((values[mid - 1] ?? 0) + (values[mid] ?? 0)) / 2 : (values[mid] ?? 0);
  if (median <= 0) return null;

  const ratio = ctcLpa / median;
  if (ratio > 1.6 || ratio < 0.6) {
    return `Reported ${ctcLpa} LPA against a median of ${median} LPA from ${values.length} other reports for this company.`;
  }
  return null;
}

export async function createOffer(
  student: StudentModel,
  values: OfferInputValues,
): Promise<SubmitResult> {
  const limit = await consumeRateLimit(`submit:${student.id}`, 10, 60 * 60);
  if (!limit.allowed) {
    return { ok: false, error: "Too many submissions in a short window. Try again shortly." };
  }

  const batch = await prisma.batch.findUnique({ where: { year: values.batchYear } });
  if (!batch) return { ok: false, error: "That batch does not exist.", field: "batchYear" };

  if (batch.isArchived) {
    return { ok: false, error: "This batch has been archived and no longer accepts submissions." };
  }

  // A student may only file against their own batch, unless an admin is doing
  // it on someone's behalf.
  if (
    student.graduationYear !== null &&
    student.graduationYear !== batch.year &&
    student.role !== "ADMIN" &&
    student.role !== "SUPER_ADMIN"
  ) {
    return {
      ok: false,
      error: `You can only record offers for your own batch (${student.graduationYear}).`,
      field: "batchYear",
    };
  }

  const company = await resolveCompany(values.companyName);

  // Tier is DERIVED from the package, never accepted from the form.
  const tierKey = await resolveTierKey(batch.id, values.ctcLpa ?? null);

  const verdict = await checkQuota(student.id, batch.id, values.cycle, tierKey);
  if (!verdict.allowed) return { ok: false, error: verdict.reason, field: "cycle" };

  const regime = await loadTaxRegime();
  const derived = deriveCompensation(
    {
      baseLpa: values.baseLpa ?? null,
      ctcLpa: values.ctcLpa ?? null,
      components: values.components.map((component) => ({
        kind: component.kind,
        amount: component.amountLpa,
        currency: "INR",
        isLpa: true,
        isOneTime: component.isOneTime,
        isCash: !["ESOP", "RSU", "INSURANCE", "PERKS"].includes(component.kind),
        vestingYears: null,
      })),
    },
    regime,
  );

  const outlierNote = await detectOutlier(
    company.id,
    batch.id,
    values.cycle,
    values.ctcLpa ?? null,
  );

  const parseDate = (value: string | undefined) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  // The package is created first and referenced by id. Prisma will not accept a
  // nested create for a relation the record owns alongside scalar foreign keys,
  // and this offer sets studentId/companyId/batchId directly.
  const isCash = (kind: string) => !["ESOP", "RSU", "INSURANCE", "PERKS"].includes(kind);

  const compensation = await prisma.compensationPackage.create({
    data: {
      stipendPerMonthInr: values.stipendPerMonthInr ?? null,
      baseLpa: values.baseLpa ?? null,
      ctcLpa: values.ctcLpa ?? null,
      disclosure: values.ctcLpa === undefined ? "PARTIAL" : "DISCLOSED",
      firstYearCashLpa: derived.firstYearCashLpa,
      steadyStateCashLpa: derived.steadyStateCashLpa,
      estimatedInHandMonthlyInr: derived.estimatedInHandMonthlyInr,
      ctcInflationRatio: derived.ctcInflationRatio,
      computedForFinancialYear: regime?.financialYear ?? null,
      computedAt: new Date(),
      components: {
        create: values.components.map((component) => ({
          kind: component.kind,
          amount: component.amountLpa,
          currency: "INR",
          isLpa: true,
          isOneTime: component.isOneTime,
          isCash: isCash(component.kind),
          note: component.note ?? null,
        })),
      },
    },
  });

  const offer = await prisma.offer.create({
    data: {
      compensationId: compensation.id,
      studentId: student.id,
      companyId: company.id,
      batchId: batch.id,
      roleTitle: values.roleTitle,
      roleFamily: values.roleFamily,
      cycle: values.cycle,
      nature: values.nature,
      tierKey,
      branchId: student.branchId,
      cgpa: values.cgpa ?? null,
      cgpaBand: cgpaBand(values.cgpa ?? null),
      backlogsAtOffer: values.backlogsAtOffer ?? null,
      priorInternshipCount: values.priorInternshipCount ?? null,
      locations: values.locations,
      workMode: values.workMode,
      bondMonths: values.bondMonths ?? null,
      internshipDurationMonths: values.internshipDurationMonths ?? null,
      announcedCgpaCutoff: values.announcedCgpaCutoff ?? null,
      eligibleBranches: values.eligibleBranches,
      offerDate: parseDate(values.offerDate),
      acceptanceStatus: values.acceptanceStatus,
      processNotes: values.processNotes ?? null,
      preparationResources: values.preparationResources ?? null,
      difficultyRating: values.difficultyRating ?? null,
      nameVisibility: values.showName ? "NAMED" : "ANONYMOUS",
      source: "SELF_REPORTED",
      verification: "UNVERIFIED",
      isOutlierFlagged: outlierNote !== null,
      outlierNote,
      rounds: {
        create: values.rounds.map((round, index) => ({
          sequence: index + 1,
          kind: round.kind,
          mode: round.mode,
          heldOn: parseDate(round.heldOn),
          platform: round.platform || null,
          topics: round.topics
            ? round.topics.split(",").map((topic) => topic.trim()).filter(Boolean).slice(0, 12)
            : [],
          difficulty: round.difficulty ?? null,
          questionsAsked: round.questionsAsked || null,
        })),
      },
    },
  });

  await recomputeCorroboration(company.id, batch.id, values.cycle);

  await recordAudit({
    actorId: student.id,
    action: "CREATE",
    entityType: "Offer",
    entityId: offer.id,
    summary: `${student.srn} recorded an offer at ${values.companyName}${
      outlierNote ? " (flagged as an outlier)" : ""
    }.`,
  });

  return { ok: true, offerId: offer.id, flagged: outlierNote !== null };
}

/**
 * Independent reports of the same company, cycle and roughly the same package
 * corroborate each other. Confidence rises with agreement rather than with
 * confidence of assertion.
 */
export async function recomputeCorroboration(
  companyId: string,
  batchId: string,
  cycle: string,
): Promise<void> {
  const offers = await prisma.offer.findMany({
    where: { companyId, batchId, cycle: cycle as never, deletedAt: null, source: "SELF_REPORTED" },
    select: { id: true, verification: true, compensation: { select: { ctcLpa: true } } },
  });

  if (offers.length < 2) return;

  const values = offers
    .map((offer) => (offer.compensation?.ctcLpa ? Number(offer.compensation.ctcLpa) : null))
    .filter((value): value is number => value !== null);
  if (values.length < 2) return;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);

  for (const offer of offers) {
    const value = offer.compensation?.ctcLpa ? Number(offer.compensation.ctcLpa) : null;
    if (value === null || median <= 0) continue;
    const agrees = Math.abs(value - median) / median <= 0.15;

    // Never downgrade a human decision.
    if (offer.verification === "ADMIN_VERIFIED" || offer.verification === "DISPUTED") continue;

    await prisma.offer.update({
      where: { id: offer.id },
      data: {
        verification: agrees ? "CORROBORATED" : offer.verification,
        confidenceScore: agrees ? Math.min(100, 40 + values.length * 10) : 20,
      },
    });
  }
}
