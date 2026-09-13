import type { PrismaClient } from "../../../generated/prisma/client.js";
import type { OfferCycle, OfferNature, RoleFamily } from "@/generated/prisma/enums";
import { deriveCompensation, type TaxRegime } from "@/lib/comp/model";
import type { ImportedRole } from "../sheets/types";

/**
 * Expanding a published headcount into the offer rows it stands for.
 *
 * The sheets say "IBM placed 88". The app's entire analytics story is built on
 * students filing their own offers, and we cannot ask the 2022 cohort to come
 * back and re-submit — so the sheet stands in for them, in their format. 88
 * becomes 88 `Offer` rows rather than the integer 88 on a `DriveRole` column.
 *
 * What we do NOT know is identity: which student each row refers to. That is
 * what `Offer.studentId` being nullable already encodes, and why nothing here
 * invents a `Student` to hang the row off. A fabricated student would be
 * counted as a person by every query that counts people.
 *
 * This is the "import-mode sibling" of `createOffer`. It deliberately does not
 * call it: `createOffer` rate-limits on `student.id`, checks the submitter's
 * `graduationYear` against the batch, runs the per-student quota, and refuses
 * an archived batch — four rules that all presuppose a real submitter. Rather
 * than thread a bypass flag through each of them (and risk that flag ever being
 * reachable from the form), the two paths stay separate and share the parts
 * that matter: the same compensation derivation, the same tier, the same table.
 */

/** Each headcount column is a different kind of offer, not a different count of one. */
const NATURE_BY_COLUMN = {
  placedInternship: "INTERNSHIP_ONLY",
  placedFte: "FTE_ONLY",
  placedBoth: "INTERNSHIP_PLUS_FTE",
} as const satisfies Record<string, OfferNature>;

export type ExpandArgs = {
  role: ImportedRole;
  driveRoleId: string;
  companyId: string;
  batchId: string;
  cycle: OfferCycle;
  tierKey: string | null;
  roleFamily: RoleFamily;
  regime: TaxRegime | null;
  eligibleBranches: string[];
  announcedCgpaCutoff: number | null;
};

/**
 * Reads the tax regime once per import rather than once per offer. The figures
 * are identical for every row in a run, and `deriveCompensation` is pure.
 *
 * This is `lib/comp/recompute`'s loader, not a copy of it. The import derives
 * compensation for rows that the app will show next to student submissions, so
 * reading the slab table differently here would put two derivations of the same
 * number in the same table.
 */
export { loadRegime as loadTaxRegimeFor } from "@/lib/comp/recompute";

/**
 * Creates one offer row per placed student for a single drive role.
 *
 * Returns the number of rows written. A role with no headcount at all writes
 * nothing: "we don't know how many" and "nobody" are different answers, and
 * only the second one is a placement of zero students.
 */
export async function expandRoleIntoOffers(
  prisma: PrismaClient,
  args: ExpandArgs,
): Promise<number> {
  const { role } = args;

  const derived = deriveCompensation(
    {
      baseLpa: role.baseLpa,
      ctcLpa: role.ctcLpa,
      components: role.components.map((component) => ({
        kind: component.kind,
        amount: component.amount,
        currency: component.currency,
        isLpa: component.isLpa,
        isOneTime: component.isOneTime,
        isCash: component.isCash,
        vestingYears: component.vestingYears,
      })),
    },
    args.regime,
  );

  let written = 0;

  for (const [column, nature] of Object.entries(NATURE_BY_COLUMN) as Array<
    [keyof typeof NATURE_BY_COLUMN, OfferNature]
  >) {
    const count = role[column];
    if (count === null || count <= 0) continue;

    for (let index = 0; index < count; index += 1) {
      // Both rows land or neither does. Written separately, a failure on the
      // offer leaves a CompensationPackage owned by nothing: no query reaches
      // it, and no re-import cleans it up, because the cleanup keys off offers.
      //
      // A nested `compensation: { create: … }` would be the neater way to say
      // this, but Prisma will not mix a relation write with the scalar foreign
      // keys below in one payload, and spelling `companyId`, `batchId`,
      // `driveRoleId` and a null `branchId` out is worth more here than brevity.
      //
      // Each offer owns its own package either way: `Offer.compensationId` is
      // unique, so these cannot share one the way merged DriveRole cells do.
      // That means one published package becomes `count` identical rows — which
      // is why inference over people has to exclude them. They are one
      // observation wearing `count` hats, not `count` observations.
      await prisma.$transaction(async (tx) => {
        const compensation = await tx.compensationPackage.create({
          data: {
            stipendPerMonthInr: role.stipendPerMonthInr,
            baseLpa: role.baseLpa,
            ctcLpa: role.ctcLpa,
            disclosure: role.disclosure,
            rawNote: role.compensationNote,
            firstYearCashLpa: derived.firstYearCashLpa,
            steadyStateCashLpa: derived.steadyStateCashLpa,
            estimatedInHandMonthlyInr: derived.estimatedInHandMonthlyInr,
            ctcInflationRatio: derived.ctcInflationRatio,
            computedForFinancialYear: args.regime?.financialYear ?? null,
            computedAt: new Date(),
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

        await tx.offer.create({
          data: {
            compensationId: compensation.id,

            // The row this stands for has no owning student, and must never be
            // given one. See the comment on Offer.studentId.
            studentId: null,
            source: "OFFICIAL_IMPORT",

            companyId: args.companyId,
            batchId: args.batchId,
            driveRoleId: args.driveRoleId,

            // The sheets frequently leave the role blank. The fallback matches
            // what the DriveRole already stores for the same row, so the offer
            // and the drive role never disagree about what the role was called.
            roleTitle: role.title ?? "Unspecified role",
            roleFamily: args.roleFamily,
            cycle: args.cycle,
            nature,
            tierKey: args.tierKey,

            // A placement sheet records placements, not pending decisions: the
            // student named in that headcount took the offer.
            acceptanceStatus: "ACCEPTED",

            locations: role.locations,
            bondMonths: role.bondMonths,
            internshipDurationMonths: role.internshipDurationMonths,
            announcedCgpaCutoff: args.announcedCgpaCutoff,
            eligibleBranches: args.eligibleBranches,

            // Everything below is a property of a person, and a headcount has
            // no person: no CGPA, no branch, no backlogs, no name to show.
            cgpa: null,
            cgpaBand: null,
            branchId: null,
            nameVisibility: "ANONYMOUS",

            // Not run through detectOutlier: an imported row IS the published
            // figure, so flagging it against itself is meaningless.
            // Corroboration skips it too — both exclude OFFICIAL_IMPORT, so
            // these rows neither gain nor grant confidence.
            verification: "UNVERIFIED",
            isOutlierFlagged: false,

            // A submission carries the rounds its student sat, and that is
            // where every date on the season page comes from. The sheet
            // records the same rounds against the drive, so each expanded row
            // gets its own copy — otherwise a whole imported season reads as
            // "no date reported" while its schedule sits one table away on
            // the DriveRole. The PPT is a drive-level talk, not a round anyone
            // sat, and stays on the drive.
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
      });

      written += 1;
    }
  }

  return written;
}
