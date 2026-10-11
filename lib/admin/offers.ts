import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { deriveCompensation } from "@/lib/comp/model";
import { loadTaxRegime } from "@/lib/comp/regime";
import { normalizeCompanyName, slugify } from "@/lib/companies/name";
import {
  restoreStandInsOf,
  reconcileStandIns,
  yieldStandIn,
} from "@/lib/offers/standins";
import { AdminError, assertAdmin, snapshot } from "./access";
import { AdminOfferInput, type AdminOfferValues } from "./input";
import { MAX_IMPORT_OUTCOMES, MAX_IMPORT_ROWS } from "./csv";

// Serialize administrative writes through one transaction-scoped lock.
// Imports run once even when two admins commit the same reviewed sheet at once.
const WRITE_LOCK = 18472011;

async function companyFor(tx: Prisma.TransactionClient, name: string) {
  const normalized = normalizeCompanyName(name);
  const alias = await tx.companyAlias.findUnique({ where: { normalized } });
  if (alias) return alias.companyId;
  const companies = await tx.company.findMany({
    select: { id: true, name: true },
  });
  const existing = companies.find(
    (company) => normalizeCompanyName(company.name) === normalized,
  );
  if (existing) {
    await tx.companyAlias.upsert({
      where: { normalized },
      create: { companyId: existing.id, alias: name, normalized },
      update: {},
    });
    return existing.id;
  }
  const base = slugify(name) || "company";
  let slug = base,
    suffix = 2;
  while (await tx.company.findUnique({ where: { slug } }))
    slug = `${base}-${suffix++}`;
  const company = await tx.company.create({
    data: { name, slug, aliases: { create: { alias: name, normalized } } },
  });
  return company.id;
}

async function references(
  tx: Prisma.TransactionClient,
  values: AdminOfferValues,
) {
  const [batch, branch] = await Promise.all([
    tx.batch.findUnique({
      where: { year: values.batchYear },
      include: { tierConfigs: { orderBy: { rank: "asc" } } },
    }),
    values.branchCode
      ? tx.branch.findUnique({ where: { code: values.branchCode } })
      : null,
  ]);
  if (!batch)
    throw new AdminError(
      `Create batch ${values.batchYear} in Batch settings before adding its data.`,
    );
  if (values.branchCode && !branch)
    throw new AdminError(`Unknown branch: ${values.branchCode}.`);
  const activeBranches = await tx.branch.findMany({ select: { code: true } });
  if (
    values.eligibleBranches.some(
      (code) => !activeBranches.some((candidate) => candidate.code === code),
    )
  )
    throw new AdminError("An eligible branch code is unknown.");
  const tier =
    values.ctcLpa === undefined
      ? null
      : batch.tierConfigs.find(
          (candidate) =>
            values.ctcLpa! >= Number(candidate.minCtcLpa) &&
            (candidate.maxCtcLpa === null ||
              values.ctcLpa! < Number(candidate.maxCtcLpa)),
        );
  return {
    batchId: batch.id,
    branchId: branch?.id ?? null,
    tierKey: tier?.key ?? null,
  };
}

type Package = Prisma.CompensationPackageGetPayload<{
  include: { components: true };
}>;

function packageData(
  values: AdminOfferValues,
  regime: Awaited<ReturnType<typeof loadTaxRegime>>,
  existing?: Package | null,
) {
  const components =
    values.components === undefined
      ? (existing?.components ?? []).map(
          ({
            kind,
            amount,
            currency,
            isLpa,
            isOneTime,
            isCash,
            vestingYears,
            note,
          }) => ({
            kind,
            amount: Number(amount),
            currency,
            isLpa,
            isOneTime,
            isCash,
            vestingYears: vestingYears === null ? null : Number(vestingYears),
            note,
          }),
        )
      : values.components.map((component) => ({
          kind: component.kind,
          amount: component.amountLpa,
          currency: "INR",
          isLpa: true,
          isOneTime: component.isOneTime,
          isCash: !["ESOP", "RSU", "INSURANCE", "PERKS"].includes(
            component.kind,
          ),
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
  return {
    ctcLpa: values.ctcLpa ?? null,
    baseLpa: values.baseLpa ?? null,
    stipendPerMonthInr: values.stipendPerMonthInr ?? null,
    disclosure:
      values.ctcLpa === undefined
        ? ("PARTIAL" as const)
        : ("DISCLOSED" as const),
    firstYearCashLpa: derived.firstYearCashLpa,
    steadyStateCashLpa: derived.steadyStateCashLpa,
    estimatedInHandMonthlyInr: derived.estimatedInHandMonthlyInr,
    ctcInflationRatio: derived.ctcInflationRatio,
    computedForFinancialYear: regime?.financialYear ?? null,
    computedAt: new Date(),
    components: { create: components },
  };
}

function offerData(values: AdminOfferValues) {
  return {
    roleTitle: values.roleTitle,
    roleFamily: values.roleFamily,
    cycle: values.cycle,
    nature: values.nature,
    workMode: values.workMode,
    locations: values.locations,
    offerDate: values.offerDate ? new Date(values.offerDate) : null,
    acceptanceStatus: values.acceptanceStatus,
    announcedCgpaCutoff: values.announcedCgpaCutoff ?? null,
    bondMonths: values.bondMonths ?? null,
    internshipDurationMonths: values.internshipDurationMonths ?? null,
    eligibleBranches: values.eligibleBranches,
    processNotes: values.processNotes || null,
  };
}

export async function saveAdminOffer(
  actorId: string,
  raw: AdminOfferValues,
  edit?: { id: string; updatedAt: string },
) {
  const values = AdminOfferInput.parse(raw);
  if (edit && values.headcount !== 1)
    throw new AdminError("An edit changes one outcome at a time.");
  const regime = await loadTaxRegime(prisma);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WRITE_LOCK})`;
      await assertAdmin(tx, actorId);
      const refs = await references(tx, values);
      const companyId = await companyFor(tx, values.companyName);
      if (edit) {
        // A row lock also protects edits racing with student deletion/moderation.
        await tx.$queryRaw`SELECT id FROM "Offer" WHERE id = ${edit.id} FOR UPDATE`;
        const before = await tx.offer.findUnique({
          where: { id: edit.id },
          include: {
            compensation: { include: { components: true } },
            rounds: true,
          },
        });
        if (!before) throw new AdminError("This offer no longer exists.");
        if (before.updatedAt.toISOString() !== edit.updatedAt)
          throw new AdminError(
            "Someone changed this offer. Reload it before saving.",
          );
        if (before.deletedAt || before.yieldedToId)
          throw new AdminError(
            "Restore the removed offer before editing. A yielded historical outcome cannot be edited independently.",
          );
        await tx.offerRevision.create({
          data: {
            offerId: before.id,
            editorId: actorId,
            snapshot: snapshot(before),
            reason: values.reason,
          },
        });
        const data = packageData(values, regime, before.compensation);
        if (before.compensationId) {
          await tx.compensationPackage.update({
            where: { id: before.compensationId },
            data: {
              ...data,
              components: { deleteMany: {}, ...data.components },
            },
          });
        }
        await restoreStandInsOf(tx, before.id);
        const compensationId =
          before.compensationId ??
          (await tx.compensationPackage.create({ data })).id;
        const after = await tx.offer.update({
          where: { id: before.id },
          data: {
            ...offerData(values),
            ...refs,
            companyId,
            verification: "ADMIN_VERIFIED",
            compensationId,
          },
        });
        if (after.studentId) await yieldStandIn(tx, after);
        await tx.auditLog.create({
          data: {
            actorId,
            action: "UPDATE",
            entityType: "Offer",
            entityId: after.id,
            before: snapshot(before),
            after: snapshot(after),
            summary: values.reason,
          },
        });
        return { offerId: after.id, count: 1 };
      }
      let offerId = "";
      for (let i = 0; i < values.headcount; i++) {
        const compensation = await tx.compensationPackage.create({
          data: { ...packageData(values, regime), rawNote: values.reason },
        });
        const offer = await tx.offer.create({
          data: {
            ...offerData(values),
            ...refs,
            companyId,
            studentId: null,
            nameVisibility: "ANONYMOUS",
            source: "ADMIN_ENTERED",
            verification: "ADMIN_VERIFIED",
            compensationId: compensation.id,
          },
        });
        offerId ||= offer.id;
        await tx.auditLog.create({
          data: {
            actorId,
            action: "CREATE",
            entityType: "Offer",
            entityId: offer.id,
            after: snapshot(offer),
            summary: values.reason,
          },
        });
      }
      await reconcileStandIns(tx, refs.batchId);
      return { offerId, count: values.headcount };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

export function importDigest(rows: AdminOfferValues[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export async function validateImportReferences(
  rows: AdminOfferValues[],
): Promise<string[]> {
  const [batches, branches] = await Promise.all([
    prisma.batch.findMany({ select: { year: true } }),
    prisma.branch.findMany({ select: { code: true } }),
  ]);
  return rows.flatMap((row, i) => {
    const errors: string[] = [];
    if (!batches.some((batch) => batch.year === row.batchYear))
      errors.push(`Row ${i + 2}: create batch ${row.batchYear} first.`);
    for (const code of [row.branchCode, ...row.eligibleBranches].filter(
      Boolean,
    ))
      if (!branches.some((branch) => branch.code === code))
        errors.push(`Row ${i + 2}: unknown branch ${code}.`);
    return errors;
  });
}

export async function commitImport(
  actorId: string,
  rawRows: AdminOfferValues[],
  expectedDigest: string,
) {
  const rows = rawRows.map((row) => AdminOfferInput.parse(row));
  const digest = importDigest(rows);
  if (
    !rows.length ||
    rows.length > MAX_IMPORT_ROWS ||
    rows.reduce((count, row) => count + row.headcount, 0) >
      MAX_IMPORT_OUTCOMES ||
    digest !== expectedDigest
  )
    throw new AdminError("The import changed. Review the file again.");
  const regime = await loadTaxRegime(prisma);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WRITE_LOCK})`;
      await assertAdmin(tx, actorId);
      if (
        await tx.auditLog.findFirst({
          where: {
            entityType: "AdminImport",
            entityId: digest,
            action: "IMPORT",
          },
        })
      )
        throw new AdminError(
          "This data was already imported. No duplicate outcomes were added.",
        );
      const ids: string[] = [],
        batchIds = new Set<string>();
      for (const values of rows) {
        const refs = await references(tx, values);
        const companyId = await companyFor(tx, values.companyName);
        batchIds.add(refs.batchId);
        for (let i = 0; i < values.headcount; i++) {
          const compensation = await tx.compensationPackage.create({
            data: { ...packageData(values, regime), rawNote: values.reason },
          });
          const offer = await tx.offer.create({
            data: {
              ...offerData(values),
              ...refs,
              companyId,
              studentId: null,
              nameVisibility: "ANONYMOUS",
              source: "OFFICIAL_IMPORT",
              verification: "ADMIN_VERIFIED",
              compensationId: compensation.id,
            },
          });
          ids.push(offer.id);
        }
      }
      for (const batchId of batchIds) await reconcileStandIns(tx, batchId);
      await tx.auditLog.create({
        data: {
          actorId,
          action: "IMPORT",
          entityType: "AdminImport",
          entityId: digest,
          after: { offerIds: ids, rowCount: rows.length },
          summary: `Imported ${ids.length} anonymous outcomes from ${rows.length} reviewed rows.`,
        },
      });
      return ids.length;
    },
    { timeout: 55_000, maxWait: 5_000 },
  );
}

export async function changeOfferVisibility(
  actorId: string,
  id: string,
  updatedAt: string,
  restore: boolean,
  reason: string,
) {
  if (reason.trim().length < 5 || reason.length > 500)
    throw new AdminError("Include a reason (5–500 characters).");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WRITE_LOCK})`;
    await assertAdmin(tx, actorId);
    await tx.$queryRaw`SELECT id FROM "Offer" WHERE id = ${id} FOR UPDATE`;
    const before = await tx.offer.findUnique({
      where: { id },
      include: {
        compensation: { include: { components: true } },
        rounds: true,
      },
    });
    if (!before || before.updatedAt.toISOString() !== updatedAt)
      throw new AdminError("This offer changed. Reload before continuing.");
    if (before.yieldedToId)
      throw new AdminError(
        "This historical outcome yielded to a student. Manage the student's entry instead to avoid counting it twice.",
      );
    await tx.offerRevision.create({
      data: {
        offerId: id,
        editorId: actorId,
        snapshot: snapshot(before),
        reason,
      },
    });
    const after = await tx.offer.update({
      where: { id },
      data: {
        deletedAt: restore ? null : new Date(),
        deletedReason: restore ? null : reason,
        verification: restore ? "ADMIN_VERIFIED" : "REMOVED",
      },
    });
    if (before.studentId) {
      if (restore) await yieldStandIn(tx, after);
      else await restoreStandInsOf(tx, id);
    }
    await tx.auditLog.create({
      data: {
        actorId,
        action: restore ? "RESTORE" : "SOFT_DELETE",
        entityType: "Offer",
        entityId: id,
        before: snapshot(before),
        after: snapshot(after),
        summary: reason,
      },
    });
  });
}

export async function undoImport(
  actorId: string,
  digest: string,
  reason: string,
) {
  if (reason.trim().length < 5 || reason.length > 500)
    throw new AdminError("Include a reason (5–500 characters).");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WRITE_LOCK})`;
    await assertAdmin(tx, actorId);
    const entry = await tx.auditLog.findFirst({
      where: { entityType: "AdminImport", entityId: digest, action: "IMPORT" },
    });
    const payload = entry?.after as { offerIds?: string[] } | null;
    if (!payload?.offerIds?.length)
      throw new AdminError("The import was not found.");
    const result = await tx.offer.updateMany({
      where: {
        id: { in: payload.offerIds },
        studentId: null,
        source: "OFFICIAL_IMPORT",
      },
      data: {
        deletedAt: new Date(),
        deletedReason: reason,
        verification: "REMOVED",
        yieldedToId: null,
      },
    });
    // Already-yielded rows stay yielded; undo never alters genuine students.
    await tx.auditLog.create({
      data: {
        actorId,
        action: "SOFT_DELETE",
        entityType: "AdminImport",
        entityId: digest,
        after: { removed: result.count },
        summary: reason,
      },
    });
    return result.count;
  });
}
