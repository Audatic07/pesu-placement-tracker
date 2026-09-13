import { describe, expect, it } from "vitest";
import { computeOutlook, parseCgpaParam, type Bar, type Point } from "@/lib/analytics/outlook";

/**
 * The one-CGPA view is a re-reading of records the app already shows, so the
 * things to pin are the reading itself: which side of a bar a CGPA falls, what
 * counts as a peer, and that the peer figures go through the gate.
 */

const TIERS = [
  { key: "TIER_1", label: "Tier 1", rank: 1 },
  { key: "TIER_2", label: "Tier 2", rank: 2 },
  { key: "TIER_3", label: "Tier 3", rank: 3 },
];

function bar(companyName: string, announcedCgpaCutoff: number): Bar {
  return { companyName, companySlug: companyName.toLowerCase(), announcedCgpaCutoff };
}

function point(cgpa: number, ctcLpa: number, tierKey: string | null = "TIER_2"): Point {
  return { cgpa, ctcLpa, tierKey };
}

describe("computeOutlook", () => {
  it("splits announced bars into cleared, within reach and out of reach", () => {
    const bars = [bar("A", 7), bar("B", 8), bar("C", 8.4), bar("D", 8.5), bar("E", 9)];

    const { eligibility } = computeOutlook(8, bars, [], TIERS, 5);

    // A bar exactly at the CGPA is cleared: the announcement is a minimum.
    expect(eligibility.cleared).toBe(2);
    expect(eligibility.withKnownBar).toBe(5);
    expect(eligibility.withinReach.map((b) => b.companyName)).toEqual(["C", "D"]);
    expect(eligibility.outOfReach.map((b) => b.companyName)).toEqual(["E"]);
  });

  it("lists the nearest bars first and counts the rest", () => {
    const bars = Array.from({ length: 14 }, (_, i) => bar(`Co${i}`, 9.9 - i * 0.05));

    const { eligibility } = computeOutlook(6, bars, [], TIERS, 5);

    expect(eligibility.outOfReachTotal).toBe(14);
    expect(eligibility.outOfReach).toHaveLength(10);
    expect(eligibility.outOfReach[0]!.announcedCgpaCutoff).toBeLessThan(
      eligibility.outOfReach[9]!.announcedCgpaCutoff,
    );
  });

  it("draws peers from a quarter point either side, inclusive", () => {
    const points = [
      point(7.75, 10),
      point(7.74, 99), // just outside
      point(8.25, 12),
      point(8.26, 99), // just outside
      point(8.0, 11),
      point(8.1, 8),
      point(7.9, 14),
    ];

    const outlook = computeOutlook(8, [], points, TIERS, 5);

    expect(outlook.peerRange).toEqual({ from: 7.75, to: 8.25 });
    expect(outlook.peers.suppressed).toBe(false);
    if (!outlook.peers.suppressed) {
      expect(outlook.peers.value.offers).toBe(5);
      expect(outlook.peers.value.medianCtc).toBe(11);
    }
  });

  it("withholds the peer figures below the minimum cohort, counts included", () => {
    const points = [point(8, 30), point(8.1, 31), point(7.9, 32), point(8.2, 33)];

    const outlook = computeOutlook(8, [], points, TIERS, 5);

    expect(outlook.peers.suppressed).toBe(true);
    if (outlook.peers.suppressed) {
      expect(outlook.peers.cohortSize).toBe(4);
      expect(outlook.peers.minimumRequired).toBe(5);
    }
  });

  it("splits a revealed cohort by tier as counts, never as packages", () => {
    const points = [
      point(8, 20, "TIER_1"),
      point(8, 8, "TIER_2"),
      point(8, 8.5, "TIER_2"),
      point(8, 4, "TIER_3"),
      point(8, 5, null),
    ];

    const outlook = computeOutlook(8, [], points, TIERS, 5);

    expect(outlook.peers.suppressed).toBe(false);
    if (!outlook.peers.suppressed) {
      expect(outlook.peers.value.byTier).toEqual([
        { tierKey: "TIER_1", label: "Tier 1", offers: 1 },
        { tierKey: "TIER_2", label: "Tier 2", offers: 2 },
        { tierKey: "TIER_3", label: "Tier 3", offers: 1 },
      ]);
      expect(outlook.peers.value.untiered).toBe(1);
      expect(Object.keys(outlook.peers.value.byTier[0]!)).not.toContain("medianCtc");
    }
  });

  it("keeps the peer window inside the scale", () => {
    expect(computeOutlook(0.1, [], [], TIERS, 5).peerRange).toEqual({ from: 0, to: 0.35 });
    expect(computeOutlook(9.9, [], [], TIERS, 5).peerRange).toEqual({ from: 9.65, to: 10 });
  });
});

describe("parseCgpaParam", () => {
  it("accepts a CGPA on the scale, to two decimals", () => {
    expect(parseCgpaParam("8.2")).toBe(8.2);
    expect(parseCgpaParam("8.123")).toBe(8.12);
    expect(parseCgpaParam("10")).toBe(10);
    expect(parseCgpaParam("0")).toBe(0);
  });

  it("treats anything else as no choice made", () => {
    expect(parseCgpaParam(undefined)).toBeNull();
    expect(parseCgpaParam("")).toBeNull();
    expect(parseCgpaParam("11")).toBeNull();
    expect(parseCgpaParam("-1")).toBeNull();
    expect(parseCgpaParam("eight")).toBeNull();
  });
});
