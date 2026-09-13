import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  STAND_IN_YIELDED,
  reconcileStandIns,
  restoreStandInsOf,
  yieldStandIn,
  type Person,
} from "@/lib/offers/standins";

/**
 * The stand-in rule, on an in-memory table.
 *
 * The invariant is "one person, counted once", and the cases that threaten it
 * are all about which row yields and when: the same nature before any other,
 * never a second one for the same submission, never a row that is already
 * gone, and back again when the submission is removed. None of that needs a
 * database to state; the fake below answers the exact query shapes the module
 * makes and nothing more.
 */

type Row = {
  id: string;
  companyId: string;
  batchId: string;
  cycle: string;
  nature: string;
  source: string;
  studentId: string | null;
  deletedAt: Date | null;
  deletedReason: string | null;
  yieldedToId: string | null;
  createdAt: Date;
};

type Where = Record<string, unknown>;

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key as keyof Row];
    if (condition !== null && typeof condition === "object" && "not" in (condition as object)) {
      return value !== (condition as { not: unknown }).not;
    }
    return value === condition;
  });
}

type FakeOffer = {
  findFirst: (args: { where: Where }) => Promise<Row | null>;
  findMany: (args: { where: Where }) => Promise<Row[]>;
  updateMany: (args: { where: Where; data: Partial<Row> }) => Promise<{ count: number }>;
};

function fakeTable(rows: Row[]): { offer: FakeOffer; client: Pick<PrismaClient, "offer"> } {
  const byCreated = (list: Row[]) => [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const offer: FakeOffer = {
    findFirst: async ({ where }) => byCreated(rows).find((row) => matches(row, where)) ?? null,
    findMany: async ({ where }) => byCreated(rows).filter((row) => matches(row, where)),
    updateMany: async ({ where, data }) => {
      const hits = rows.filter((row) => matches(row, where));
      for (const row of hits) Object.assign(row, data);
      return { count: hits.length };
    },
  };
  // The module only ever calls these three, with the shapes the fake answers.
  return { offer, client: { offer } as unknown as Pick<PrismaClient, "offer"> };
}

let clock = 0;
function standIn(id: string, nature: string, overrides: Partial<Row> = {}): Row {
  clock += 1;
  return {
    id,
    companyId: "ibm",
    batchId: "b2026",
    cycle: "FULL_TIME",
    nature,
    source: "OFFICIAL_IMPORT",
    studentId: null,
    deletedAt: null,
    deletedReason: null,
    yieldedToId: null,
    createdAt: new Date(2026, 0, clock),
    ...overrides,
  };
}

function person(id: string, nature = "FTE_ONLY"): Person {
  return { id, companyId: "ibm", batchId: "b2026", cycle: "FULL_TIME", nature: nature as Person["nature"] };
}

describe("yieldStandIn", () => {
  it("prefers a stand-in of the same nature, then takes any", async () => {
    const rows = [standIn("s-intern", "INTERNSHIP_PLUS_FTE"), standIn("s-fte", "FTE_ONLY")];
    const { client: prisma } = fakeTable(rows);

    expect(await yieldStandIn(prisma, person("p1", "FTE_ONLY"))).toBe("s-fte");
    expect(rows[1]).toMatchObject({ deletedAt: expect.any(Date), deletedReason: STAND_IN_YIELDED, yieldedToId: "p1" });

    // Only the other nature is left standing; it yields rather than nothing.
    expect(await yieldStandIn(prisma, person("p2", "FTE_ONLY"))).toBe("s-intern");
  });

  it("never yields twice for one submission", async () => {
    const rows = [standIn("s1", "FTE_ONLY"), standIn("s2", "FTE_ONLY")];
    const { client: prisma } = fakeTable(rows);

    expect(await yieldStandIn(prisma, person("p1"))).toBe("s1");
    expect(await yieldStandIn(prisma, person("p1"))).toBe("s1");
    expect(rows.filter((row) => row.deletedAt === null)).toHaveLength(1);
  });

  it("returns null when nothing stood for the person", async () => {
    const { client: prisma } = fakeTable([standIn("elsewhere", "FTE_ONLY", { companyId: "tcs" })]);
    expect(await yieldStandIn(prisma, person("p1"))).toBeNull();
  });

  it("ignores rows that are not stand-ins: a person's own row, or one already gone", async () => {
    const rows = [
      standIn("someone", "FTE_ONLY", { source: "SELF_REPORTED", studentId: "stu-1" }),
      standIn("gone", "FTE_ONLY", { deletedAt: new Date(), deletedReason: "removed" }),
    ];
    expect(await yieldStandIn(fakeTable(rows).client, person("p1"))).toBeNull();
  });

  it("moves on when a candidate is taken between the read and the write", async () => {
    const rows = [standIn("s1", "FTE_ONLY"), standIn("s2", "FTE_ONLY")];
    const { offer, client: prisma } = fakeTable(rows);
    // Simulate another submission claiming s1 the instant it is picked.
    const original = offer.updateMany;
    let raced = false;
    offer.updateMany = async (args) => {
      if (!raced && args.where["id"] === "s1") {
        raced = true;
        rows[0]!.deletedAt = new Date();
        rows[0]!.yieldedToId = "someone-else";
      }
      return original(args);
    };

    expect(await yieldStandIn(prisma, person("p1"))).toBe("s2");
    expect(rows[0]!.yieldedToId).toBe("someone-else");
  });
});

describe("restoreStandInsOf", () => {
  it("brings back what yielded to the removed offer, and nothing else", async () => {
    const rows = [standIn("s1", "FTE_ONLY"), standIn("s2", "FTE_ONLY")];
    const { client: prisma } = fakeTable(rows);
    await yieldStandIn(prisma, person("p1"));
    await yieldStandIn(prisma, person("p2"));

    expect(await restoreStandInsOf(prisma, "p1")).toBe(1);
    expect(rows[0]).toMatchObject({ deletedAt: null, deletedReason: null, yieldedToId: null });
    expect(rows[1]!.yieldedToId).toBe("p2");
  });
});

describe("reconcileStandIns", () => {
  it("lets every person on record displace one stand-in after a fresh expansion", async () => {
    const rows = [
      standIn("s1", "FTE_ONLY"),
      standIn("s2", "FTE_ONLY"),
      standIn("s3", "FTE_ONLY"),
      standIn("p1", "FTE_ONLY", { source: "SELF_REPORTED", studentId: "stu-1" }),
      standIn("p2", "FTE_ONLY", { source: "SELF_REPORTED", studentId: "stu-2" }),
      standIn("p-removed", "FTE_ONLY", { source: "SELF_REPORTED", studentId: "stu-3", deletedAt: new Date() }),
    ];
    const { client: prisma } = fakeTable(rows);

    expect(await reconcileStandIns(prisma, "b2026")).toBe(2);
    expect(rows.filter((row) => row.source === "OFFICIAL_IMPORT" && row.deletedAt === null)).toHaveLength(1);
    // Running it again changes nothing: each person already displaced one.
    expect(await reconcileStandIns(prisma, "b2026")).toBe(2);
    expect(rows.filter((row) => row.source === "OFFICIAL_IMPORT" && row.deletedAt === null)).toHaveLength(1);
  });
});
