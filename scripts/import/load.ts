import type { PrismaClient } from "../../generated/prisma/client.js";
import type { DriveStatus } from "@/generated/prisma/enums";
import {
  buildKnownAliasIndex,
  normalizeCompanyName,
  similarityKey,
  slugify,
} from "./lib/companies";
import { classifyRoleFamily, natureFromHeadcounts, refineNatureFromNote } from "./lib/roles";
import type { ReviewLog } from "./lib/review";
import type { ImportedDrive, ImportedWorkbook } from "./sheets/types";

/**
 * Writes a parsed workbook into the database.
 *
 * Two things here are less obvious than they look.
 *
 * 1. A company appearing on both the Tier 1 and Tier 2 tabs is ONE visit whose
 *    roles happened to fall in different tiers — Infosys is on both. A company
 *    appearing twice on the SAME tab genuinely came twice — HSBC did. So blocks
 *    are merged across sheets and split within a sheet.
 *
 * 2. Tier belongs to the role, not the company. Cognizant's Senior Associate is
 *    tier 1 and its GenC programme is tier 2, in the same drive.
 */

export type LoadResult = {
  companies: number;
  drives: number;
  roles: number;
  rounds: number;
};

type CompanyRef = { id: string; name: string };

class CompanyResolver {
  private readonly byNormalized = new Map<string, CompanyRef>();
  private readonly bySimilarity = new Map<string, CompanyRef>();
  private readonly knownAliases = buildKnownAliasIndex();
  private created = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly review: ReviewLog,
  ) {}

  get createdCount(): number {
    return this.created;
  }

  async warm(): Promise<void> {
    const companies = await this.prisma.company.findMany({ include: { aliases: true } });
    for (const company of companies) {
      const ref = { id: company.id, name: company.name };
      this.byNormalized.set(normalizeCompanyName(company.name), ref);
      for (const alias of company.aliases) {
        this.byNormalized.set(alias.normalized, ref);
      }
      this.bySimilarity.set(similarityKey(company.name), ref);
    }
  }

  async resolve(rawName: string, context: { sheet: string; row: number }): Promise<CompanyRef> {
    const known = this.knownAliases.get(normalizeCompanyName(rawName));
    const canonicalName = known?.canonical ?? rawName;
    const normalized = normalizeCompanyName(canonicalName);

    const existing = this.byNormalized.get(normalized);
    if (existing) {
      // Register this spelling so the next lookup is a direct hit, and so the
      // submission form can match what a student types.
      await this.ensureAlias(existing.id, rawName);
      return existing;
    }

    // Before creating, check whether something very similar already exists.
    // Suggest, never merge: "Progress" and "Progress Software" are the same
    // company, but two unrelated startups can share a similarity key.
    const similar = this.bySimilarity.get(similarityKey(canonicalName));
    if (similar) {
      this.review.add({
        severity: "DECIDED",
        sheet: context.sheet,
        row: context.row,
        company: rawName,
        field: "Company identity",
        rawValue: rawName,
        outcome: `Created as a separate company from "${similar.name}".`,
        reason:
          "The names normalise to the same key. If they are the same company, merge them in the " +
          "admin console or add an alias in scripts/import/lib/companies.ts.",
      });
    }

    let parentId: string | null = null;
    if (known?.parent) {
      const parent = await this.resolve(known.parent, context);
      parentId = parent.id;
    }

    const company = await this.prisma.company.create({
      data: {
        name: canonicalName,
        slug: await this.uniqueSlug(canonicalName),
        parentId,
        aliases: {
          create: [{ alias: rawName, normalized: normalizeCompanyName(rawName) }].filter(
            (alias) => alias.normalized !== normalized,
          ),
        },
      },
    });

    this.created += 1;
    const ref = { id: company.id, name: company.name };
    this.byNormalized.set(normalized, ref);
    this.byNormalized.set(normalizeCompanyName(rawName), ref);
    this.bySimilarity.set(similarityKey(canonicalName), ref);
    return ref;
  }

  private async ensureAlias(companyId: string, rawName: string): Promise<void> {
    const normalized = normalizeCompanyName(rawName);
    if (this.byNormalized.has(normalized)) return;

    await this.prisma.companyAlias.upsert({
      where: { normalized },
      update: {},
      create: { companyId, alias: rawName, normalized },
    });
    const ref = [...this.byNormalized.values()].find((entry) => entry.id === companyId);
    if (ref) this.byNormalized.set(normalized, ref);
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || "company";
    let candidate = base;
    let suffix = 2;
    while (await this.prisma.company.findUnique({ where: { slug: candidate } })) {
      candidate = `${base}-${suffix++}`;
    }
    return candidate;
  }
}

function statusFor(drive: { flags: ImportedDrive["flags"]; roles: ImportedDrive["roles"] }): DriveStatus {
  if (drive.flags.ditched) return "DITCHED";
  if (drive.flags.hiredNobody) return "NO_HIRES";

  const totalPlaced = drive.roles.reduce(
    (sum, role) =>
      sum + (role.placedInternship ?? 0) + (role.placedFte ?? 0) + (role.placedBoth ?? 0),
    0,
  );
  if (totalPlaced > 0) return "COMPLETED";

  // Explicit zeros mean the process ran and produced nothing; blanks mean we
  // simply do not know, which is not the same thing.
  const hasExplicitZero = drive.roles.some(
    (role) => role.placedInternship === 0 || role.placedFte === 0 || role.placedBoth === 0,
  );
  return hasExplicitZero ? "NO_HIRES" : "ANNOUNCED";
}

type DriveGroup = {
  companyId: string;
  companyName: string;
  visitNumber: number;
  blocks: ImportedDrive[];
};

/**
 * Merges blocks across sheets and splits repeat visits within a sheet.
 *
 * Grouping keys on the RESOLVED company id, not the spelling in the cell.
 * "Eternal" and "Eternal(Zomato)" are two spellings of one company, and
 * grouping by name would produce two drives that then collide on the
 * (company, batch, cycle, visit) unique key.
 */
function groupDrives(
  drives: Array<{ drive: ImportedDrive; company: CompanyRef }>,
): DriveGroup[] {
  const seenPerSheet = new Map<string, number>();
  const groups = new Map<string, DriveGroup>();

  for (const { drive, company } of drives) {
    const perSheetKey = `${company.id}::${drive.cycle}::${drive.sheet}`;
    const visitNumber = (seenPerSheet.get(perSheetKey) ?? 0) + 1;
    seenPerSheet.set(perSheetKey, visitNumber);

    const groupKey = `${company.id}::${drive.cycle}::${visitNumber}`;
    const group = groups.get(groupKey);
    if (group) {
      group.blocks.push(drive);
    } else {
      groups.set(groupKey, {
        companyId: company.id,
        companyName: company.name,
        visitNumber,
        blocks: [drive],
      });
    }
  }

  return [...groups.values()];
}

export async function loadWorkbook(
  prisma: PrismaClient,
  parsed: ImportedWorkbook,
  review: ReviewLog,
): Promise<LoadResult> {
  const batch = await prisma.batch.findUnique({
    where: { year: parsed.batchYear },
    include: { tierConfigs: { orderBy: { rank: "asc" } } },
  });
  if (!batch) {
    throw new Error(
      `No batch row for ${parsed.batchYear}. Run \`npm run seed\` before importing.`,
    );
  }

  // Re-importing replaces previously imported drives. Student submissions live
  // in a different table and are never touched, but an offer linked to a drive
  // role would lose that link, so check before destroying anything.
  const priorDrives = await prisma.drive.findMany({
    where: { batchId: batch.id, source: "OFFICIAL_IMPORT" },
    select: { id: true },
  });

  if (priorDrives.length > 0) {
    const linkedOffers = await prisma.offer.count({
      where: {
        source: { not: "OFFICIAL_IMPORT" },
        driveRole: { driveId: { in: priorDrives.map((drive) => drive.id) } },
      },
    });

    if (linkedOffers > 0 && !process.argv.includes("--force")) {
      throw new Error(
        `${linkedOffers} student-submitted offer(s) are linked to previously imported drives for ` +
          `${parsed.batchYear}. Re-importing would unlink them. Re-run with --force if that is intended.`,
      );
    }

    await prisma.drive.deleteMany({
      where: { batchId: batch.id, source: "OFFICIAL_IMPORT" },
    });
  }

  // Deleting a drive cascades to its roles, but a compensation package is not
  // owned by the role that points at it — several roles can share one — so the
  // packages survive as orphans. Without this, every re-import leaves the last
  // run's packages behind and the table grows without bound.
  const orphaned = await prisma.compensationPackage.deleteMany({
    where: { driveRoles: { none: {} }, offer: { is: null } },
  });
  if (orphaned.count > 0) {
    console.log(`  removed ${orphaned.count} orphaned compensation package(s) from a prior run`);
  }

  const resolver = new CompanyResolver(prisma, review);
  await resolver.warm();

  // Resolve every company first: grouping depends on identity, not spelling.
  const resolved: Array<{ drive: ImportedDrive; company: CompanyRef }> = [];
  for (const drive of parsed.drives) {
    const company = await resolver.resolve(drive.companyName, {
      sheet: drive.sheet,
      row: drive.sheetRow,
    });
    resolved.push({ drive, company });
  }

  const groups = groupDrives(resolved);
  let driveCount = 0;
  let roleCount = 0;
  let roundCount = 0;

  for (const { companyId, companyName, visitNumber, blocks } of groups) {
    const first = blocks[0]!;
    const company = { id: companyId, name: companyName };

    // Merge the block-level attributes. Later blocks fill in gaps rather than
    // overwrite, so the tab with richer data wins without ordering mattering.
    const flags = blocks.reduce(
      (merged, block) => ({
        isRepeatCompany: merged.isRepeatCompany || block.flags.isRepeatCompany,
        hiredTenPlus: merged.hiredTenPlus || block.flags.hiredTenPlus,
        massHired: merged.massHired || block.flags.massHired,
        hiredNobody: merged.hiredNobody || block.flags.hiredNobody,
        ditched: merged.ditched || block.flags.ditched,
        isFooter: false,
      }),
      first.flags,
    );

    const gpa = blocks.find((block) => block.gpaCutoff.raw)?.gpaCutoff ?? first.gpaCutoff;
    const eligibleBranches = [
      ...new Set(blocks.flatMap((block) => block.eligibleBranches)),
    ];
    const pptDate = blocks.find((block) => block.pptDate)?.pptDate ?? null;
    const roles = blocks.flatMap((block) =>
      block.roles.map((role) => ({ role, tierKey: block.tierKey })),
    );

    const notes = [
      ...new Set(
        blocks
          .map((block) => block.note)
          .concat(blocks.map((block) => block.inlineNote))
          .filter((note): note is string => Boolean(note)),
      ),
    ].join("\n");

    const drive = await prisma.drive.create({
      data: {
        companyId: company.id,
        batchId: batch.id,
        cycle: first.cycle,
        visitNumber,
        status: statusFor({ flags, roles: roles.map((entry) => entry.role) }),
        pptDate,
        eligibleBranches,
        eligiblePrograms: [],
        gpaCutoffRaw: gpa.raw || null,
        gpaCutoffNumeric: gpa.numeric,
        gpaCutoffKind: gpa.kind,
        source: "OFFICIAL_IMPORT",
        notes: notes || null,
      },
    });
    driveCount += 1;

    if (flags.isRepeatCompany && visitNumber === 1) {
      review.add({
        severity: "DECIDED",
        sheet: first.sheet,
        row: first.sheetRow,
        company: company.name,
        field: "Repeat company",
        rawValue: "purple fill in the source sheet",
        outcome: "Recorded as a single drive.",
        reason:
          "The sheet marks this company as a repeat recruiter but lists only one block on this tab; " +
          "the second visit may be recorded elsewhere or not at all.",
      });
    }

    // Tracks the package a run of merged role rows shares.
    let lastCompensationId: string | null = null;

    for (const { role, tierKey } of roles) {
      // Tier comes from the source tab where there is one. Only sources with no
      // tier concept at all derive it from the CTC — see ImportedWorkbook.
      let resolvedTier = tierKey;
      if (parsed.deriveTierFromCtc && resolvedTier === null && role.ctcLpa !== null) {
        resolvedTier =
          batch.tierConfigs.find((tier) => {
            const min = Number(tier.minCtcLpa);
            const max = tier.maxCtcLpa === null ? Infinity : Number(tier.maxCtcLpa);
            return role.ctcLpa! >= min && role.ctcLpa! < max;
          })?.key ?? null;
      }

      const nature = refineNatureFromNote(
        natureFromHeadcounts({
          internship: role.placedInternship,
          fte: role.placedFte,
          both: role.placedBoth,
        }),
        role.note ?? notes,
      );

      // A merged compensation cell means these roles share one advertised
      // package. Point them at the same row rather than duplicating it, so an
      // average over packages counts it once — which is what the source sheet's
      // own AVERAGE does, and what is actually true.
      let compensationId = lastCompensationId;
      if (!role.sharesCompensationWithPrevious || compensationId === null) {
        const compensation = await prisma.compensationPackage.create({
          data: {
            stipendPerMonthInr: role.stipendPerMonthInr,
            baseLpa: role.baseLpa,
            ctcLpa: role.ctcLpa,
            disclosure: role.disclosure,
            rawNote: role.compensationNote,
            components: {
              create: role.components.map((component) => ({
                kind: component.kind,
                amount: component.amount,
                currency: component.currency,
                isLpa: component.isLpa,
                isOneTime: component.isOneTime,
                isCash: component.isCash,
                vestingYears: component.vestingYears,
                note: component.note,
              })),
            },
          },
        });
        compensationId = compensation.id;
        lastCompensationId = compensation.id;
      }

      const driveRole = await prisma.driveRole.create({
        data: {
          driveId: drive.id,
          title: role.title ?? "Unspecified role",
          roleFamily: classifyRoleFamily(role.title),
          nature,
          tierKey: resolvedTier,
          locations: role.locations,
          bondMonths: role.bondMonths,
          internshipDurationMonths: role.internshipDurationMonths,
          compensationId,
          placedInternship: role.placedInternship,
          placedFte: role.placedFte,
          placedBoth: role.placedBoth,
          notes: role.note,
          rounds: {
            create: role.rounds.map((round) => ({
              sequence: round.sequence,
              kind: round.kind,
              mode: round.mode,
              heldOn: round.heldOn,
              heldUntil: round.heldUntil,
              rawSchedule: round.rawSchedule,
            })),
          },
        },
      });

      roleCount += 1;
      roundCount += role.rounds.length;

      if (parsed.deriveTierFromCtc && resolvedTier === null && role.ctcLpa !== null) {
        review.add({
          severity: "UNRESOLVED",
          sheet: first.sheet,
          row: role.sheetRow,
          company: company.name,
          field: "Tier",
          rawValue: String(role.ctcLpa),
          outcome: `Role ${driveRole.title} stored with no tier.`,
          reason: "The CTC falls outside every configured tier boundary for this batch.",
        });
      }
    }

    // The pre-placement talk is a round in its own right, and students want its
    // date as much as the OA's.
    if (pptDate) {
      const firstRole = await prisma.driveRole.findFirst({
        where: { driveId: drive.id },
        orderBy: { createdAt: "asc" },
      });
      if (firstRole) {
        await prisma.interviewRound.create({
          data: {
            driveRoleId: firstRole.id,
            sequence: 0,
            kind: "PRE_PLACEMENT_TALK",
            mode: "UNKNOWN",
            heldOn: pptDate,
          },
        });
        roundCount += 1;
      }
    }
  }

  return {
    companies: resolver.createdCount,
    drives: driveCount,
    roles: roleCount,
    rounds: roundCount,
  };
}
