import "server-only";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { checkQuota } from "@/lib/policy/quota";
import { resolveTierKey } from "@/lib/policy/batch";
import { cgpaBand } from "@/lib/privacy/gate";
import { deriveCompensation } from "@/lib/comp/model";
import { consumeRateLimit } from "@/lib/rate-limit";
import { normalizeCompanyName, slugify } from "@/lib/companies/name";
import type { OfferCycle } from "@/generated/prisma/enums";
import type { OfferInputValues } from "./schema";
import { yieldStandIn } from "./standins";
import { median } from "@/lib/analytics/stats";
import { loadTaxRegime } from "@/lib/comp/regime";
import type { StudentModel } from "@/generated/prisma/models";

/** Creates an offer after deriving its tier, checking the quota and computing compensation. */

export type SubmitResult =
  | { ok: true; offerId: string; flagged: boolean }
  | { ok: false; error: string; field?: string };

/**
 * Resolves a typed company name to a company row, creating one only when no
 * existing name or alias matches. Free-text entry is how the source sheets
 * ended up with four spellings of IBM; matching against every recorded alias
 * first is what stops that happening again.
 */
async function resolveCompany(rawName: string): Promise<{ id: string }> {
  const name = rawName.trim();
  const normalized = normalizeCompanyName(name);

  const alias = await prisma.companyAlias.findUnique({
    where: { normalized },
    select: { companyId: true },
  });
  if (alias) return { id: alias.companyId };

  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const exact = companies.find((company) => normalizeCompanyName(company.name) === normalized);
  if (exact) {
    await prisma.companyAlias.create({
      data: { companyId: exact.id, alias: name, normalized },
    });
    return { id: exact.id };
  }

  const baseSlug = slugify(name) || "company";
  let slug = baseSlug;
  let suffix = 2;
  while (await prisma.company.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${suffix++}`;
  }

  const created = await prisma.company.create({
    data: { name, slug, aliases: { create: [{ alias: name, normalized }] } },
  });
  return { id: created.id };
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
  cycle: OfferCycle,
  ctcLpa: number | null,
): Promise<string | null> {
  if (ctcLpa === null) return null;

  const peers = await prisma.offer.findMany({
    where: {
      companyId,
      batchId,
      cycle,
      deletedAt: null,
      verification: { notIn: ["DISPUTED", "REMOVED"] },
      compensation: { ctcLpa: { not: null } },
      source: { not: "OFFICIAL_IMPORT" },
    },
    select: { compensation: { select: { ctcLpa: true } } },
  });

  if (peers.length < 3) return null;

  const values = peers.flatMap((peer) =>
    peer.compensation?.ctcLpa == null ? [] : [Number(peer.compensation.ctcLpa)],
  );
  const peerMedian = median(values);
  if (peerMedian === null || peerMedian <= 0) return null;

  const ratio = ctcLpa / peerMedian;
  if (ratio > 1.6 || ratio < 0.6) {
    return `Reported ${ctcLpa} LPA against a median of ${peerMedian} LPA from ${values.length} other reports for this company.`;
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

  const regime = await loadTaxRegime(prisma);
  const components = values.components.map((component) => ({
    kind: component.kind,
    amount: component.amountLpa,
    currency: "INR",
    isLpa: true,
    isOneTime: component.isOneTime,
    isCash: !["ESOP", "RSU", "INSURANCE", "PERKS"].includes(component.kind),
    vestingYears: null,
    note: component.note ?? null,
  }));
  const derived = deriveCompensation(
    {
      baseLpa: values.baseLpa ?? null,
      ctcLpa: values.ctcLpa ?? null,
      components,
    },
    regime,
  );

  const outlierNote = await detectOutlier(
    company.id,
    batch.id,
    values.cycle,
    values.ctcLpa ?? null,
  );

  // Keep the package and offer together: a failed offer must not leave an orphan.
  const { offer, displaced } = await prisma.$transaction(async (tx) => {
    const compensation = await tx.compensationPackage.create({
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
        components: { create: components },
      },
    });

    const createdOffer = await tx.offer.create({
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
        offerDate: values.offerDate ? new Date(values.offerDate) : null,
        acceptanceStatus: values.acceptanceStatus,
        processNotes: values.processNotes ?? null,
        preparationResources: values.preparationResources ?? null,
        difficultyRating: values.difficultyRating ?? null,
        nameVisibility: "ANONYMOUS",
        source: "SELF_REPORTED",
        verification: "UNVERIFIED",
        isOutlierFlagged: outlierNote !== null,
        outlierNote,
        rounds: {
          create: values.rounds.map((round, index) => ({
            sequence: index + 1,
            kind: round.kind,
            mode: round.mode,
            heldOn: round.heldOn ? new Date(round.heldOn) : null,
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
    const displacedStandIn = await yieldStandIn(tx, {
      id: createdOffer.id,
      companyId: company.id,
      batchId: batch.id,
      cycle: values.cycle,
      nature: values.nature,
    });
    return { offer: createdOffer, displaced: displacedStandIn };
  });

  await recomputeCorroboration(company.id, batch.id, values.cycle);

  await recordAudit({
    actorId: student.id,
    action: "CREATE",
    entityType: "Offer",
    entityId: offer.id,
    after: displaced ? { displacedStandIn: displaced } : undefined,
    summary: `${student.srn} recorded an offer at ${values.companyName}${
      outlierNote ? " (flagged as an outlier)" : ""
    }${displaced ? ", replacing a row expanded from the batch's sheet" : ""}.`,
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
  cycle: OfferCycle,
): Promise<void> {
  const offers = await prisma.offer.findMany({
    where: { companyId, batchId, cycle, deletedAt: null, source: { not: "OFFICIAL_IMPORT" } },
    select: { id: true, verification: true, compensation: { select: { ctcLpa: true } } },
  });

  if (offers.length < 2) return;

  const values = offers
    .map((offer) => (offer.compensation?.ctcLpa ? Number(offer.compensation.ctcLpa) : null))
    .filter((value): value is number => value !== null);
  if (values.length < 2) return;

  const peerMedian = median(values);
  if (peerMedian === null || peerMedian <= 0) return;

  for (const offer of offers) {
    const value = offer.compensation?.ctcLpa ? Number(offer.compensation.ctcLpa) : null;
    if (value === null) continue;
    const agrees = Math.abs(value - peerMedian) / peerMedian <= 0.15;

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
