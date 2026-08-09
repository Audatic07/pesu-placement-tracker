import type { PrismaClient } from "../../generated/prisma/client.js";
import type { ImportedWorkbook, SheetFooterStats } from "./sheets/types";

/**
 * Proving the import is faithful.
 *
 * Each tab of the source workbook computes its own totals in a footer block —
 * companies visited, students placed, highest/average/median CTC. Those numbers
 * were produced by the spreadsheet, independently of anything here. If the
 * database reproduces them, the import is right. If it does not, the import is
 * wrong, and this reports that rather than quietly adjusting expectations.
 */

type Check = {
  label: string;
  expected: number | null;
  actual: number | null;
  tolerance: number;
  /**
   * Reported but not counted as a failure, because the source computes it in a
   * way we deliberately do not reproduce. See TIER_1_FILTER_NOTE.
   */
  informational?: boolean;
  note?: string;
};

/**
 * Tier 1's headline average and median are not plain averages. The sheet's
 * formula is:
 *
 *   AVERAGE(FILTER(F5:F150, F5:F150<>F76, F5:F150<>F54, F5:F150<>F11,
 *                  F5:F150<>F12, F5:F150<>F13, F5:F150<>F78, F5:F150<>F23))
 *
 * — an ad-hoc exclusion of companies that ditched (ION Group, Arista, Oracle
 * OFSS) or hired nobody (Titan Email, Confluent). The intent is reasonable. The
 * execution is not: FILTER excludes by VALUE, so it also silently drops every
 * other company that happens to share a CTC with one of them — Make My Trip,
 * Komprise and Tekion all vanish because they are also at 22 LPA.
 *
 * Reproducing that would mean copying a bug into the analytics. So these two
 * figures are reported for comparison but not treated as a fidelity test; the
 * unfiltered count, sum, maximum and headcounts below are what prove the rows
 * landed correctly, and Tier 2 and Tier 3 use plain AVERAGE/MEDIAN and must
 * match to the decimal.
 */
const TIER_1_FILTER_NOTE =
  "source excludes ditched/no-hire companies by value, which also drops unrelated companies " +
  "sharing those CTCs — not reproduced deliberately";

/**
 * Places where the source's own summary is demonstrably wrong, with the
 * evidence. The import matches the ROWS; it deliberately does not match a
 * footer that miscounts them.
 *
 * Each entry must cite the formula that proves it, so a future maintainer can
 * re-check rather than take this on trust.
 */
const KNOWN_SOURCE_DEFECTS: Array<{
  label: string;
  statedValue: number;
  correctValue: number;
  evidence: string;
}> = [
  {
    label: "Summer Internship PPOs: company blocks read",
    statedValue: 14,
    correctValue: 15,
    evidence:
      "The tab's count is COUNTA(A3:A16) but its data runs to row 17, so CISCO is missing from it — " +
      "and from MAX/AVERAGE/MEDIAN(E3:E16) — while SUM(F3:F20) does include it. A row was added " +
      "below the formula range and the range was never extended.",
  },
];

export type VerifyReport = {
  allMatched: boolean;
  text: string;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? null);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const TIER_TABS: Array<{ sheet: string; tierKey: string }> = [
  { sheet: "Tier 1", tierKey: "TIER_1" },
  { sheet: "Tier 2", tierKey: "TIER_2" },
  { sheet: "Tier 3", tierKey: "TIER_3" },
];

export async function verifyAgainstFooters(
  prisma: PrismaClient,
  parsed: ImportedWorkbook,
): Promise<VerifyReport> {
  const batch = await prisma.batch.findUniqueOrThrow({
    where: { year: parsed.batchYear },
  });

  const footersBySheet = new Map<string, SheetFooterStats>(
    parsed.footers.map((footer) => [footer.sheet, footer]),
  );

  const checks: Check[] = [];

  for (const { sheet, tierKey } of TIER_TABS) {
    const footer = footersBySheet.get(sheet);
    if (!footer) continue;

    const roles = await prisma.driveRole.findMany({
      where: {
        tierKey,
        drive: { batchId: batch.id, source: "OFFICIAL_IMPORT" },
      },
      include: { compensation: true, drive: { select: { id: true } } },
    });

    // The sheet's COUNTA counts company BLOCKS, so a company listed twice on a
    // tab counts twice — Epsilon is on Tier 1 twice, HCLTech on Tier 3 twice.
    // Each block became its own drive, so drives are the right unit here;
    // counting distinct companies would under-report by the repeats.
    const driveCount = new Set(roles.map((role) => role.drive.id)).size;

    // One value per PACKAGE, not per role: roles sharing a merged compensation
    // cell share a package row, and the source counts it once.
    const packageCtc = new Map<string, number>();
    for (const role of roles) {
      if (!role.compensation?.ctcLpa) continue;
      packageCtc.set(role.compensation.id, Number(role.compensation.ctcLpa));
    }
    const ctcValues = [...packageCtc.values()];

    const placedInternship = roles.reduce((sum, r) => sum + (r.placedInternship ?? 0), 0);
    const placedFte = roles.reduce((sum, r) => sum + (r.placedFte ?? 0), 0);
    const placedBoth = roles.reduce((sum, r) => sum + (r.placedBoth ?? 0), 0);

    checks.push(
      {
        label: `${sheet}: companies visited`,
        expected: footer.companiesVisited,
        actual: driveCount,
        tolerance: 0,
      },
      {
        label: `${sheet}: placed (internship)`,
        expected: footer.placedInternship,
        actual: placedInternship,
        tolerance: 0,
      },
      {
        label: `${sheet}: placed (FTE)`,
        expected: footer.placedFte,
        actual: placedFte,
        tolerance: 0,
      },
      {
        label: `${sheet}: placed (both)`,
        expected: footer.placedBoth,
        actual: placedBoth,
        tolerance: 0,
      },
      {
        label: `${sheet}: placed (total)`,
        expected: footer.placedTotal,
        actual: placedInternship + placedFte + placedBoth,
        tolerance: 0,
      },
      {
        label: `${sheet}: highest CTC`,
        expected: footer.highestCtc,
        actual: ctcValues.length ? Math.max(...ctcValues) : null,
        tolerance: 0.01,
      },
      {
        label: `${sheet}: average CTC`,
        expected: footer.averageCtc,
        actual: mean(ctcValues),
        tolerance: 0.0001,
        informational: tierKey === "TIER_1",
        note: tierKey === "TIER_1" ? TIER_1_FILTER_NOTE : undefined,
      },
      {
        label: `${sheet}: median CTC`,
        expected: footer.medianCtc,
        actual: median(ctcValues),
        tolerance: 0.0001,
        informational: tierKey === "TIER_1",
        note: tierKey === "TIER_1" ? TIER_1_FILTER_NOTE : undefined,
      },
    );
  }

  // Whole-batch totals, from the Overall Stats tab of the source.
  const allRoles = await prisma.driveRole.findMany({
    where: { drive: { batchId: batch.id, source: "OFFICIAL_IMPORT" } },
    select: { placedInternship: true, placedFte: true, placedBoth: true },
  });
  const grandTotal = allRoles.reduce(
    (sum, role) =>
      sum + (role.placedInternship ?? 0) + (role.placedFte ?? 0) + (role.placedBoth ?? 0),
    0,
  );
  // Not every tab has a "Grand Total" row — Internship Only records only its
  // single placed figure — so fall back to summing the three columns.
  const expectedGrandTotal = parsed.footers.reduce(
    (sum, footer) =>
      sum +
      (footer.placedTotal ??
        (footer.placedInternship ?? 0) + (footer.placedFte ?? 0) + (footer.placedBoth ?? 0)),
    0,
  );

  checks.push({
    label: "All tabs: students placed",
    expected: expectedGrandTotal || null,
    actual: grandTotal,
    tolerance: 0,
  });

  // Every tab's COUNTA of the company column, checked per tab. This covers the
  // two tabs with no tier — "Internship Only" and "Summer Internship PPOs" —
  // whose rows are otherwise unverified by the tier checks above.
  for (const footer of parsed.footers) {
    const blocks = parsed.drives.filter((drive) => drive.sheet === footer.sheet).length;
    checks.push({
      label: `${footer.sheet}: company blocks read`,
      expected: footer.companiesVisited,
      actual: blocks,
      tolerance: 0,
    });
  }

  const lines: string[] = [];
  let allMatched = true;

  for (const check of checks) {
    if (check.expected === null) {
      lines.push(`    ?  ${check.label}: the sheet records no total to check against`);
      continue;
    }

    const defect = KNOWN_SOURCE_DEFECTS.find(
      (entry) => entry.label === check.label && entry.statedValue === check.expected,
    );
    if (defect) {
      const matched = Math.abs((check.actual ?? Number.NaN) - defect.correctValue) <= check.tolerance;
      if (!matched) allMatched = false;
      lines.push(
        `    ${matched ? "ok" : "XX"} ${check.label}: sheet says ${defect.statedValue}, ` +
          `correct value is ${defect.correctValue}, imported ${check.actual ?? "—"}\n` +
          `          source defect: ${defect.evidence}`,
      );
      continue;
    }

    const actual = check.actual ?? Number.NaN;
    const matched = Math.abs(actual - check.expected) <= check.tolerance;
    if (!matched && !check.informational) allMatched = false;

    const format = (value: number | null) =>
      value === null || Number.isNaN(value)
        ? "—"
        : Number.isInteger(value)
          ? String(value)
          : value.toFixed(6);

    const marker = matched ? "ok" : check.informational ? "--" : "XX";
    lines.push(
      `    ${marker} ${check.label}: sheet ${format(check.expected)}, imported ${format(actual)}` +
        (!matched && check.note ? `\n          ${check.note}` : ""),
    );
  }

  return { allMatched, text: lines.join("\n") };
}
