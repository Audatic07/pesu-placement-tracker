import { gate, type Suppressible } from "@/lib/privacy/gate";
import { median, percentile } from "./stats";

/**
 * What past data says about one CGPA.
 *
 * A student picks a CGPA — their own, or one they are aiming for — and the
 * batch's records answer two questions about it. Which announced bars does it
 * clear? And what did people at that CGPA actually get? Both are read from
 * records the app already shows; this only reads them from one angle.
 *
 * Pure, so it can be tested without a database: the queries module loads the
 * rows and hands them here.
 *
 * Nothing here says which company to want. The "out of reach" list is sorted
 * by how far the bar is, not by package, and no company is ranked above
 * another — the product's own rule against becoming a leaderboard applies to
 * a personalised view as much as to the batch's.
 */

/** How far either side of the chosen CGPA counts as "people like you". */
export const PEER_HALF_WIDTH = 0.25;

/** A bar within this much above the chosen CGPA is within reach, not out of it. */
export const WITHIN_REACH = 0.5;

/** The most names listed for one group; the rest are counted. */
const NAMES_SHOWN = 10;

export type Bar = {
  companyName: string;
  companySlug: string;
  announcedCgpaCutoff: number;
};

export type Point = {
  cgpa: number;
  ctcLpa: number;
  tierKey: string | null;
};

export type TierLabel = { key: string; label: string; rank: number };

export type NamedBar = Bar;

export type Eligibility = {
  /** Companies with an announced bar on record for this batch. */
  withKnownBar: number;
  /** Bars at or below the CGPA. */
  cleared: number;
  /** Bars above the CGPA by no more than WITHIN_REACH, nearest first. */
  withinReach: NamedBar[];
  withinReachTotal: number;
  /** Bars further above than that, nearest first. */
  outOfReach: NamedBar[];
  outOfReachTotal: number;
};

export type PeerOutcomes = {
  offers: number;
  medianCtc: number | null;
  p25Ctc: number | null;
  p75Ctc: number | null;
  /** Counts only. A count is not a value; a per-tier package at this size would be. */
  byTier: Array<{ tierKey: string; label: string; offers: number }>;
  untiered: number;
};

export type CgpaOutlook = {
  cgpa: number;
  /** The window the peer figures are drawn from. */
  peerRange: { from: number; to: number };
  eligibility: Eligibility;
  peers: Suppressible<PeerOutcomes>;
};

export function computeOutlook(
  cgpa: number,
  bars: Bar[],
  points: Point[],
  tiers: TierLabel[],
  minimum?: number,
): CgpaOutlook {
  const nearestFirst = (a: Bar, b: Bar) => a.announcedCgpaCutoff - b.announcedCgpaCutoff;

  const cleared = bars.filter((bar) => bar.announcedCgpaCutoff <= cgpa);
  const withinReach = bars
    .filter((bar) => bar.announcedCgpaCutoff > cgpa && bar.announcedCgpaCutoff <= cgpa + WITHIN_REACH)
    .sort(nearestFirst);
  const outOfReach = bars
    .filter((bar) => bar.announcedCgpaCutoff > cgpa + WITHIN_REACH)
    .sort(nearestFirst);

  const from = Math.max(0, round2(cgpa - PEER_HALF_WIDTH));
  const to = Math.min(10, round2(cgpa + PEER_HALF_WIDTH));
  const peers = points.filter((point) => point.cgpa >= from && point.cgpa <= to);

  return {
    cgpa,
    peerRange: { from, to },
    eligibility: {
      withKnownBar: bars.length,
      cleared: cleared.length,
      withinReach: withinReach.slice(0, NAMES_SHOWN),
      withinReachTotal: withinReach.length,
      outOfReach: outOfReach.slice(0, NAMES_SHOWN),
      outOfReachTotal: outOfReach.length,
    },
    peers: gate(
      peers.length,
      () => {
        const values = peers.map((point) => point.ctcLpa);
        return {
          offers: peers.length,
          medianCtc: median(values),
          p25Ctc: percentile(values, 0.25),
          p75Ctc: percentile(values, 0.75),
          byTier: [...tiers]
            .sort((a, b) => a.rank - b.rank)
            .map((tier) => ({
              tierKey: tier.key,
              label: tier.label,
              offers: peers.filter((point) => point.tierKey === tier.key).length,
            })),
          untiered: peers.filter((point) => point.tierKey === null).length,
        };
      },
      minimum,
    ),
  };
}

/** A CGPA typed into a URL: two decimals, inside the scale, or nothing. */
export function parseCgpaParam(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0 || value > 10) return null;
  return round2(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
