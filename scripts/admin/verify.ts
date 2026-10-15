import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/db";
import { AdminOfferInput } from "../../lib/admin/input";
import {
  commitImport,
  importDigest,
  saveAdminOffer,
  changeOfferVisibility,
  undoImport,
} from "../../lib/admin/offers";
import { updateUserAccess } from "../../lib/admin/users";
import { applyBootstrapAdmin } from "../../lib/auth/provision";
import { BatchSettings, saveBatchSettings } from "../../lib/admin/batches";

const target = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.NODE_ENV === "production" ||
  !["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)
)
  throw new Error(
    "Admin verification requires a disposable localhost database.",
  );

let passed = 0;
function check(name: string, condition: unknown) {
  assert.ok(condition, name);
  passed++;
  console.log(`PASS ${name}`);
}

async function main() {
  try {
    const suffix = randomUUID().toUpperCase();
    const owner = await prisma.student.create({
      data: {
        srn: `OWNER-${suffix}`,
        name: "Synthetic owner",
        role: "SUPER_ADMIN",
      },
    });
    const admin = await prisma.student.create({
      data: { srn: `ADMIN-${suffix}`, name: "Synthetic admin", role: "ADMIN" },
    });
    const student = await prisma.student.create({
      data: {
        srn: `STUDENT-${suffix}`,
        name: "Synthetic student",
        role: "STUDENT",
      },
    });
    const batch = await prisma.batch.upsert({
      where: { year: 2000 },
      create: {
        year: 2000,
        tierConfigs: {
          create: [{ key: "TIER_1", label: "Tier 1", rank: 1, minCtcLpa: 0 }],
        },
        submissionRule: {
          create: { maxFullTimeTotal: 0, maxFullTimePerTier: 0 },
        },
      },
      update: {},
    });
    const values = AdminOfferInput.parse({
      batchYear: batch.year,
      companyName: `Synthetic Admin ${suffix}`,
      roleTitle: "Engineer",
      cycle: "FULL_TIME",
      nature: "FTE_ONLY",
      headcount: 3,
      ctcLpa: 12,
      baseLpa: 8,
      reason: "Synthetic test source",
    });

    const created = await saveAdminOffer(admin.id, values);
    check("admin entry bypasses personal quotas", created.count === 3);
    const offers = await prisma.offer.findMany({
      where: { company: { name: values.companyName } },
      include: { compensation: true },
    });
    check(
      "anonymous entry has no student's identity",
      offers.length === 3 &&
        offers.every(
          (offer) =>
            offer.studentId === null && offer.nameVisibility === "ANONYMOUS",
        ),
    );
    check(
      "compensation is derived",
      offers.every(
        (offer) => Number(offer.compensation?.firstYearCashLpa) === 8,
      ),
    );
    check(
      "every manual outcome has an atomic audit entry",
      (await prisma.auditLog.count({
        where: {
          entityType: "Offer",
          entityId: { in: offers.map((offer) => offer.id) },
          action: "CREATE",
        },
      })) === 3,
    );
    await assert.rejects(saveAdminOffer(student.id, values), /access changed/);
    passed++;
    console.log("PASS student cannot call the admin write service");
    const suspended = await prisma.student.update({
      where: { id: admin.id },
      data: { isSuspended: true },
    });
    await assert.rejects(
      saveAdminOffer(suspended.id, values),
      /access changed/,
    );
    passed++;
    console.log("PASS suspended admin cannot write");
    await prisma.student.update({
      where: { id: admin.id },
      data: { isSuspended: false },
    });

    const before = offers[0]!;
    await saveAdminOffer(
      admin.id,
      { ...values, headcount: 1, ctcLpa: 15 },
      { id: before.id, updatedAt: before.updatedAt.toISOString() },
    );
    await assert.rejects(
      saveAdminOffer(
        admin.id,
        { ...values, headcount: 1 },
        { id: before.id, updatedAt: before.updatedAt.toISOString() },
      ),
      /Someone changed/,
    );
    passed++;
    console.log("PASS stale edit is refused");
    check(
      "edit preserves a complete previous snapshot",
      (await prisma.offerRevision.count({ where: { offerId: before.id } })) ===
        1,
    );
    const updated = await prisma.offer.findUniqueOrThrow({
      where: { id: before.id },
    });
    await changeOfferVisibility(
      admin.id,
      updated.id,
      updated.updatedAt.toISOString(),
      false,
      "Synthetic reversible removal",
    );
    const removed = await prisma.offer.findUniqueOrThrow({
      where: { id: before.id },
    });
    check(
      "removal is reversible and audited",
      removed.deletedAt !== null &&
        (await prisma.auditLog.count({
          where: { entityId: removed.id, action: "SOFT_DELETE" },
        })) === 1,
    );
    await changeOfferVisibility(
      admin.id,
      removed.id,
      removed.updatedAt.toISOString(),
      true,
      "Synthetic restore reason",
    );
    check(
      "restore returns an active outcome",
      (await prisma.offer.findUniqueOrThrow({ where: { id: before.id } }))
        .deletedAt === null,
    );

    const importedValues = {
      ...values,
      companyName: `Synthetic Import ${suffix}`,
      headcount: 2,
    };
    const rows = [importedValues],
      digest = importDigest(rows);
    const concurrent = await Promise.allSettled([
      commitImport(admin.id, rows, digest),
      commitImport(admin.id, rows, digest),
    ]);
    check(
      "concurrent identical imports commit only once",
      concurrent.filter((result) => result.status === "fulfilled").length === 1,
    );
    check(
      "identical imports cannot double the headcount",
      (await prisma.offer.count({
        where: { company: { name: importedValues.companyName } },
      })) === 2,
    );
    const personal = await prisma.offer.create({
      data: {
        studentId: student.id,
        batchId: batch.id,
        companyId: (
          await prisma.company.findUniqueOrThrow({
            where: { name: importedValues.companyName },
          })
        ).id,
        roleTitle: "Engineer",
        cycle: "FULL_TIME",
        nature: "FTE_ONLY",
        locations: [],
        eligibleBranches: [],
      },
    });
    const { reconcileStandIns } = await import("../../lib/offers/standins");
    await reconcileStandIns(prisma, batch.id);
    check(
      "historical outcome yields to genuine student submission",
      (await prisma.offer.count({ where: { yieldedToId: personal.id } })) === 1,
    );
    await undoImport(admin.id, digest, "Synthetic duplicate source withdrawn");
    check(
      "undo preserves genuine student submissions",
      (await prisma.offer.findUniqueOrThrow({ where: { id: personal.id } }))
        .deletedAt === null,
    );
    await changeOfferVisibility(
      admin.id,
      personal.id,
      personal.updatedAt.toISOString(),
      false,
      "Synthetic student removal",
    );
    check(
      "an undone historical row cannot resurrect through student removal",
      (await prisma.offer.count({
        where: {
          company: { name: importedValues.companyName },
          studentId: null,
          deletedAt: null,
        },
      })) === 0,
    );

    const invalidRows = [
      { ...values, companyName: `Rollback ${suffix}`, headcount: 1 },
      { ...values, branchCode: "INVALID" },
    ];
    await assert.rejects(
      commitImport(admin.id, invalidRows, importDigest(invalidRows)),
      /Unknown branch/,
    );
    check(
      "failed import rolls back company, offers, packages and audit",
      (await prisma.company.count({
        where: { name: `Rollback ${suffix}` },
      })) === 0 &&
        (await prisma.auditLog.count({
          where: { entityId: importDigest(invalidRows) },
        })) === 0,
    );
    await assert.rejects(commitImport(admin.id, rows, "tampered"), /Review/);
    passed++;
    console.log("PASS import review fingerprint is checked");

    const account = await prisma.student.findUniqueOrThrow({
      where: { id: student.id },
    });
    await assert.rejects(
      updateUserAccess(admin.id, {
        id: account.id,
        updatedAt: account.updatedAt.toISOString(),
        role: "ADMIN",
        suspended: false,
        reason: "Synthetic grant",
      }),
      /access changed/,
    );
    passed++;
    console.log("PASS only owners grant roles");
    await updateUserAccess(owner.id, {
      id: account.id,
      updatedAt: account.updatedAt.toISOString(),
      role: "ADMIN",
      suspended: false,
      reason: "Synthetic grant",
    });
    check(
      "owner grants admin with audit",
      (await prisma.student.findUniqueOrThrow({ where: { id: student.id } }))
        .role === "ADMIN",
    );
    await assert.rejects(
      updateUserAccess(owner.id, {
        id: owner.id,
        updatedAt: owner.updatedAt.toISOString(),
        role: "STUDENT",
        suspended: false,
        reason: "Synthetic demotion",
      }),
      /own access/,
    );
    passed++;
    console.log("PASS owner cannot demote themself");
    const configuredOwner = process.env.SUPER_ADMIN_SRN;
    process.env.SUPER_ADMIN_SRN = admin.srn;
    const lostOwner = await prisma.student.update({
      where: { id: admin.id },
      data: {
        role: "STUDENT",
        isSuspended: true,
        suspendedReason: "Synthetic lockout",
      },
    });
    const recovered = await applyBootstrapAdmin(lostOwner);
    check(
      "verified recovery owner regains role and suspension access",
      recovered.role === "SUPER_ADMIN" && !recovered.isSuspended,
    );
    check(
      "recovery is idempotent",
      (await applyBootstrapAdmin(recovered)).role === "SUPER_ADMIN",
    );
    if (configuredOwner === undefined) delete process.env.SUPER_ADMIN_SRN;
    else process.env.SUPER_ADMIN_SRN = configuredOwner;
    check(
      "writes increment the batch data version",
      (await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } }))
        .dataVersion > batch.dataVersion,
    );
    const settings = BatchSettings.parse({
      year: batch.year,
      updatedAt: (
        await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })
      ).updatedAt.toISOString(),
      archived: true,
      maxSummerInternships: 1,
      maxSixMonthInternships: 3,
      maxFullTimePerTier: 1,
      maxFullTimeTotal: 3,
      closeLowerTiers: true,
      description: "Synthetic policy",
      reason: "Synthetic season archive",
      tiers: [
        {
          key: "TIER_1",
          label: "Tier 1",
          rank: 1,
          minCtcLpa: 0,
          maxCtcLpa: null,
        },
      ],
    });
    await saveBatchSettings(owner.id, settings);
    check(
      "batch settings are managed without reseeding",
      (await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } }))
        .isArchived,
    );
    console.log(`\n${passed} administrative integration checks passed.`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
