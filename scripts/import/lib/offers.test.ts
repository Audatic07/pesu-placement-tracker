import { describe, expect, it } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import type { ImportedRole } from "../sheets/types";
import { expandRoleIntoOffers, type ExpandArgs } from "./offers";

/**
 * These assert the two properties the whole import-as-offers change rests on:
 * a headcount of N becomes N rows, and not one of those rows is attached to a
 * person. The second is the one that matters — a fabricated `studentId` would
 * be counted as a human being by every query that counts human beings.
 */

type Written = { offers: Array<Record<string, unknown>>; packages: number; transactions: number };

/**
 * Just enough of the client for the two `create` calls the expander makes.
 * A real database is not needed to prove how many rows it asks for, or what it
 * puts in them.
 *
 * Only `$transaction` is reachable: the package and the offer are written
 * together or not at all, so a fake that also answered `prisma.offer.create`
 * directly would let that pairing regress without a test noticing.
 */
function fakePrisma(): { prisma: PrismaClient; written: Written } {
  const written: Written = { offers: [], packages: 0, transactions: 0 };
  const tx = {
    compensationPackage: {
      create: async () => {
        written.packages += 1;
        return { id: `pkg-${written.packages}` };
      },
    },
    offer: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        written.offers.push(data);
        return { id: `offer-${written.offers.length}` };
      },
    },
  };
  const prisma = {
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => {
      written.transactions += 1;
      return run(tx);
    },
  } as unknown as PrismaClient;
  return { prisma, written };
}

function role(overrides: Partial<ImportedRole> = {}): ImportedRole {
  return {
    title: "SDE",
    stipendPerMonthInr: null,
    baseLpa: null,
    ctcLpa: 12,
    sharesCompensationWithPrevious: false,
    disclosure: "DISCLOSED",
    compensationNote: null,
    components: [],
    placedInternship: null,
    placedFte: null,
    placedBoth: null,
    locations: [],
    bondMonths: null,
    internshipDurationMonths: null,
    note: null,
    rounds: [],
    sheetRow: 2,
    ...overrides,
  } as ImportedRole;
}

function args(r: ImportedRole): ExpandArgs {
  return {
    role: r,
    driveRoleId: "drive-role-1",
    companyId: "company-1",
    batchId: "batch-1",
    cycle: "FULL_TIME",
    tierKey: "T1",
    roleFamily: "SDE",
    regime: null,
    eligibleBranches: ["CSE"],
    announcedCgpaCutoff: 7,
  };
}

describe("expandRoleIntoOffers", () => {
  it("turns a headcount of 3 into 3 offer rows, each with its own package", async () => {
    const { prisma, written } = fakePrisma();

    const count = await expandRoleIntoOffers(prisma, args(role({ placedFte: 3 })));

    expect(count).toBe(3);
    expect(written.offers).toHaveLength(3);
    // Offer.compensationId is unique, so these cannot share one row.
    expect(written.packages).toBe(3);
    // Each pair inside its own transaction: a package must never outlive a
    // failed offer write, because nothing would ever reach or clean it up.
    expect(written.transactions).toBe(3);
  });

  it("never attaches a student, and never claims one anonymously", async () => {
    const { prisma, written } = fakePrisma();

    await expandRoleIntoOffers(prisma, args(role({ placedFte: 2 })));

    for (const offer of written.offers) {
      expect(offer.studentId).toBeNull();
      expect(offer.source).toBe("OFFICIAL_IMPORT");
      // Everything below is a property of a person, and there is no person.
      expect(offer.cgpa).toBeNull();
      expect(offer.cgpaBand).toBeNull();
      expect(offer.branchId).toBeNull();
      expect(offer.nameVisibility).toBe("ANONYMOUS");
    }
  });

  it("reads each headcount column as a different kind of offer", async () => {
    const { prisma, written } = fakePrisma();

    const count = await expandRoleIntoOffers(
      prisma,
      args(role({ placedInternship: 1, placedFte: 2, placedBoth: 1 })),
    );

    expect(count).toBe(4);
    expect(written.offers.map((offer) => offer.nature)).toEqual([
      "INTERNSHIP_ONLY",
      "FTE_ONLY",
      "FTE_ONLY",
      "INTERNSHIP_PLUS_FTE",
    ]);
  });

  it("writes nothing when the sheet never recorded a headcount", async () => {
    const { prisma, written } = fakePrisma();

    // "We don't know how many" and "nobody" are different answers, and only
    // the second is a placement of zero students. Neither writes an offer.
    expect(await expandRoleIntoOffers(prisma, args(role()))).toBe(0);
    expect(await expandRoleIntoOffers(prisma, args(role({ placedFte: 0 })))).toBe(0);
    expect(written.offers).toHaveLength(0);
  });

  it("falls back to the title the DriveRole stores, so the two never disagree", async () => {
    const { prisma, written } = fakePrisma();

    await expandRoleIntoOffers(prisma, args(role({ title: null, placedFte: 1 })));

    expect(written.offers[0]!.roleTitle).toBe("Unspecified role");
  });

  it("gives every expanded row its own copy of the drive role's rounds", async () => {
    const { prisma, written } = fakePrisma();
    const rounds = [
      {
        kind: "ONLINE_ASSESSMENT",
        mode: "ONLINE",
        sequence: 1,
        heldOn: new Date("2025-09-01T00:00:00Z"),
        heldUntil: null,
        rawSchedule: null,
      },
      {
        kind: "TECHNICAL_INTERVIEW",
        mode: "UNKNOWN",
        sequence: 2,
        heldOn: null,
        heldUntil: null,
        rawSchedule: "TBD",
      },
    ] as ImportedRole["rounds"];

    await expandRoleIntoOffers(prisma, args(role({ placedFte: 2, rounds })));

    // The season page dates a company by the earliest round anyone recorded.
    // Without these, an imported season has no dates at all.
    for (const offer of written.offers) {
      const nested = offer.rounds as { create: Array<Record<string, unknown>> };
      expect(nested.create).toHaveLength(2);
      expect(nested.create[0]).toMatchObject({ kind: "ONLINE_ASSESSMENT", sequence: 1 });
      expect(nested.create[1]).toMatchObject({ kind: "TECHNICAL_INTERVIEW", rawSchedule: "TBD" });
    }
  });

  it("records the placement as accepted and leaves it unflagged", async () => {
    const { prisma, written } = fakePrisma();

    await expandRoleIntoOffers(prisma, args(role({ placedBoth: 1 })));

    // A placement sheet records placements, not pending decisions.
    expect(written.offers[0]!.acceptanceStatus).toBe("ACCEPTED");
    // An imported row IS the published figure; flagging it against itself is
    // meaningless, and detectOutlier never sees it.
    expect(written.offers[0]!.isOutlierFlagged).toBe(false);
    expect(written.offers[0]!.verification).toBe("UNVERIFIED");
  });
});
