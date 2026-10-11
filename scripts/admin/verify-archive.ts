import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/db";
import { archiveFixture } from "./archive-fixture";
import { loadPlacementArchive } from "../../lib/admin/archive";
import { archiveSummary } from "../../lib/admin/archive-schema";
import { createLogicalBackup } from "../../lib/admin/backup";
import { ensureBatch } from "../../lib/policy/batch";

const target = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.NODE_ENV === "production" ||
  !["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)
)
  throw new Error(
    "Archive verification requires a disposable localhost database.",
  );

async function main() {
  try {
    const suffix = randomUUID();
    const owner = await prisma.student.create({
      data: {
        srn: `ARCHIVE-OWNER-${suffix}`,
        name: "Synthetic owner",
        role: "SUPER_ADMIN",
      },
    });
    const admin = await prisma.student.create({
      data: {
        srn: `ARCHIVE-ADMIN-${suffix}`,
        name: "Synthetic admin",
        role: "ADMIN",
      },
    });
    const student = await prisma.student.create({
      data: {
        srn: `ARCHIVE-STUDENT-${suffix}`,
        name: "Synthetic student",
        role: "STUDENT",
      },
    });
    const fixture = archiveFixture(
      `handmade-${randomUUID().replaceAll("-", "")}`,
      `Synthetic Archive ${suffix}`,
    );
    // Isolate repeat runs while testing exactly the same batch policy.
    // The schema accepts historical years only; choose a free year in its range.
    let batchYear = 2001;
    while (
      await prisma.offer.count({
        where: { source: "OFFICIAL_IMPORT", batch: { year: batchYear } },
      })
    )
      batchYear++;
    if (batchYear >= 2099)
      throw new Error("Use a fresh disposable verification database.");
    fixture.entries[0]!.batchYear = batchYear;
    fixture.expected = { [batchYear]: 1 };
    const digest = archiveSummary(fixture).digest;
    await assert.rejects(
      loadPlacementArchive(student.id, fixture, digest),
      /access changed/,
    );
    await assert.rejects(
      loadPlacementArchive(admin.id, fixture, digest),
      /access changed/,
    );
    await assert.rejects(
      loadPlacementArchive(owner.id, fixture, digest),
      /backup/,
    );
    await assert.rejects(
      loadPlacementArchive(owner.id, fixture, "0".repeat(64)),
      /changed after review/,
    );
    console.log("PASS role, backup and reviewed-content checks");

    const backup = await createLogicalBackup(owner.id);
    assert.ok(backup);
    const invalid = structuredClone(fixture);
    invalid.expected = { "2099": 1 };
    invalid.entries[0]!.batchYear = 2099;
    invalid.entries[0]!.tierKey = "MISSING_TIER";
    const existed = await prisma.batch.count({ where: { year: 2099 } });
    await assert.rejects(
      loadPlacementArchive(owner.id, invalid, archiveSummary(invalid).digest),
      /missing a recorded/,
    );
    assert.equal(await prisma.batch.count({ where: { year: 2099 } }), existed);
    assert.equal(
      await prisma.offer.count({ where: { id: fixture.entries[0]!.id } }),
      0,
    );
    console.log(
      "PASS failed import rolls back batch provisioning and all outcomes",
    );

    const batch = await ensureBatch(batchYear);
    const company = await prisma.company.create({
      data: {
        name: fixture.entries[0]!.companyName,
        slug: `synthetic-archive-${suffix}`,
      },
    });
    const genuine = await prisma.offer.create({
      data: {
        studentId: student.id,
        batchId: batch.id,
        companyId: company.id,
        cycle: "FULL_TIME",
        nature: "FTE_ONLY",
        roleTitle: "Student's own engineer entry",
        source: "SELF_REPORTED",
        processNotes: "Personal details must survive archive publication.",
      },
    });
    const [first, second] = await Promise.all([
      loadPlacementArchive(owner.id, fixture, digest),
      loadPlacementArchive(owner.id, fixture, digest),
    ]);
    assert.equal(
      Number(first.alreadyImported) + Number(second.alreadyImported),
      1,
    );
    assert.equal(first.yielded + second.yielded, 1);
    assert.equal(
      await prisma.auditLog.count({
        where: { entityType: "PlacementArchive", entityId: digest },
      }),
      1,
    );
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: fixture.entries[0]!.id },
      include: {
        compensation: { include: { components: true } },
        rounds: true,
      },
    });
    assert.equal(offer.yieldedToId, genuine.id);
    assert.equal(offer.acceptanceStatus, "UNKNOWN");
    assert.equal(offer.studentId, null);
    assert.equal(Number(offer.compensation!.components[0]!.amount), 1000.25);
    assert.equal(offer.compensation!.components[0]!.currency, "USD");
    assert.equal(Number(offer.compensation!.components[0]!.vestingYears), 4);
    assert.equal(offer.compensation!.estimatedInHandMonthlyInr, null);
    assert.equal(
      offer.rounds[0]!.heldUntil?.toISOString(),
      fixture.entries[0]!.rounds[0]!.heldUntil,
    );
    assert.equal(offer.rounds[0]!.rawSchedule, "10–11 October");
    assert.deepEqual(
      await prisma.offer.findUniqueOrThrow({ where: { id: genuine.id } }),
      genuine,
    );
    console.log(
      "PASS concurrent import commits once, preserves detailed fields and yields to the genuine submission",
    );

    await prisma.offer.update({
      where: { id: offer.id },
      data: { processNotes: "Owner correction after import" },
    });
    assert.equal(
      (await loadPlacementArchive(owner.id, fixture, digest)).alreadyImported,
      true,
    );
    assert.equal(
      (await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } }))
        .processNotes,
      "Owner correction after import",
    );
    const changed = structuredClone(fixture);
    changed.entries[0]!.processNotes = "Changed overlapping source";
    await assert.rejects(
      loadPlacementArchive(owner.id, changed, archiveSummary(changed).digest),
      /already exist/,
    );
    await prisma.student.update({
      where: { id: owner.id },
      data: { isSuspended: true },
    });
    await assert.rejects(
      loadPlacementArchive(owner.id, fixture, digest),
      /access changed/,
    );
    console.log(
      "PASS retries preserve corrections, changed overlaps are refused, suspended owners lose access immediately",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
