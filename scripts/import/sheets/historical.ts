import type { Cell, Workbook, Worksheet } from "exceljs";
import type {
  DisclosureStatus,
  OfferCycle,
  RoundKind,
} from "@/generated/prisma/enums";
import { parseSheetDate, seasonWindowForBatch, type SeasonWindow } from "../lib/dates";
import { parseAmountCell, parseCompensationNote } from "../lib/compensation";
import { parseGpaCutoff } from "../lib/gpa";
import { cleanCompanyName } from "../lib/companies";
import {
  parseBondMonths,
  parseInternshipMonths,
  parseLocations,
} from "../lib/roles";
import type { ReviewLog } from "../lib/review";
import type {
  ImportedDrive,
  ImportedRole,
  ImportedRound,
  ImportedWorkbook,
  SheetFooterStats,
} from "./types";

/**
 * Reader for the older placement workbooks — the 2022, 2023, 2024 and 2025
 * seasons.
 *
 * These predate the 2026 rewrite and are shaped differently from it, so they
 * get their own reader rather than being forced through scene2026:
 *
 *   - A company block is identified by a repeated "#" index column, not by a
 *     merged company cell. The company name is written on every role row.
 *   - Nothing is encoded in cell colour. Round mode is therefore always UNKNOWN
 *     and there are no colour-coded company flags.
 *   - Stipends are written in shorthand — "1L", "35k", "60k", "15k-20k" — where
 *     2026 used plain rupee figures. parseStipendCell below normalises them.
 *   - Dates live in explicit PPT / Test / Interview columns rather than being
 *     inferred from fills.
 *   - There is no self-computed footer summary block to verify against, so these
 *     imports are proven by the review log and a manual read, not by re-deriving
 *     the sheet's own totals. `footers` is returned empty for that reason.
 *
 * Each tab declares its column layout in a HistoricalTab, and the reader checks
 * the header row before reading a single value so a reshuffled column fails
 * loudly rather than silently mapping a stipend into the CTC field.
 */

export type HistoricalColumns = {
  /** The "#" index column that identifies a company block. */
  id: number;
  company: number;
  role: number;
  stipend: number | null;
  base: number | null;
  ctc: number | null;
  /** "FTE Only" / "FTE" / "Jobs Offered" — students placed as FTE. */
  placedFte: number | null;
  /** "FTE + Intern" — students placed as both. */
  placedBoth: number | null;
  /** "Intern" / "Intern (PBC)" — students placed as internship only. */
  placedInternship: number | null;
  pptDate: number | null;
  /** "Test Date" — becomes an ONLINE_ASSESSMENT round. */
  testDate: number | null;
  /** "Interview" — becomes a TECHNICAL_INTERVIEW round. */
  interviewDate: number | null;
  gpaCutoff: number | null;
  note: number | null;
};

export type HistoricalTab = {
  sheet: string;
  headerRow: number;
  firstDataRow: number;
  expectedHeaders: Array<[number, RegExp]>;
  columns: HistoricalColumns;
  tierKey: string | null;
  cycle: OfferCycle;
};

export type HistoricalConfig = {
  batchYear: number;
  tabs: HistoricalTab[];
};

/** A readable string form of any cell value, mirroring scene2026's cellText. */
function cellText(cell: Cell): string | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;

  const fromRichText = (candidate: unknown): string | null => {
    if (candidate === null || typeof candidate !== "object") return null;
    if (!("richText" in candidate)) return null;
    const runs = (candidate as { richText?: unknown }).richText;
    if (!Array.isArray(runs)) return null;
    const text = runs.map((run) => (run as { text?: string }).text ?? "").join("");
    return text.trim() || null;
  };

  if (typeof value === "object" && !(value instanceof Date)) {
    const direct = fromRichText(value);
    if (direct !== null) return direct;
    if ("text" in value) {
      const inner = (value as { text?: unknown }).text;
      if (typeof inner === "string") return inner.trim() || null;
      const nested = fromRichText(inner);
      if (nested !== null) return nested;
    }
    if ("result" in value) {
      const result = (value as { result?: unknown }).result;
      return result === null || result === undefined ? null : String(result).trim() || null;
    }
    if ("error" in value) return null;
  }

  if (value instanceof Date) return value.toISOString();

  const text = String(value).replace(/\u00a0/g, " ").trim();
  if (!text || text === "[object Object]") return null;
  return text;
}

/**
 * Counts students from a headcount cell. "0" is a real answer (ran a process,
 * hired nobody); blank and "-" mean "we don't know".
 */
function headcount(cell: Cell): number | null {
  const value = cell.value;
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cellText(cell);
  if (!text || text === "-" || text === "--") return null;
  const parsed = Number.parseInt(text.replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalises a stipend cell written in the shorthand the old sheets use.
 *
 *   80000, 125000   plain rupees per month
 *   "1L", "1.5L"    lakhs           -> ×100000
 *   "35k", "60k"    thousands       -> ×1000
 *   "15k-20k"       a range         -> the lower end
 *   "-", ""         unknown         -> null
 */
export function parseStipendCell(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const raw = String(value).replace(/\s+/g, " ").trim();
  if (!raw || raw === "-" || raw === "--") return null;

  const match = /(\d+(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|l|k)?/i.exec(raw);
  if (!match?.[1]) return null;

  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return null;

  const unit = (match[2] ?? "").toLowerCase();
  if (unit === "k") return amount * 1_000;
  if (unit && unit !== "k") return amount * 100_000; // l / lpa / lakh / lac
  return amount;
}

function disclosureFor(
  stipend: number | null,
  base: ReturnType<typeof parseAmountCell>,
  ctc: ReturnType<typeof parseAmountCell>,
): DisclosureStatus {
  if (base.isPerformanceBased || ctc.isPerformanceBased) return "PERFORMANCE_BASED";
  if (ctc.value !== null) return base.value !== null ? "DISCLOSED" : "PARTIAL";
  if (base.value !== null || stipend !== null) return "PARTIAL";
  return "NOT_DISCLOSED";
}

function verifyHeaders(sheet: Worksheet, tab: HistoricalTab, batchYear: number): void {
  const problems: string[] = [];
  for (const [column, pattern] of tab.expectedHeaders) {
    const actual = cellText(sheet.getCell(tab.headerRow, column)) ?? "";
    if (!pattern.test(actual)) {
      problems.push(`  column ${column}: expected ${pattern} but found "${actual.replace(/\n/g, " ")}"`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Sheet "${tab.sheet}" (batch ${batchYear}) does not have the expected layout — refusing to ` +
        `import rather than map columns wrongly.\n${problems.join("\n")}\n` +
        `If the sheet has legitimately changed, update its config in scripts/import/sheets/historical.ts.`,
    );
  }
}

/** Trailing statuses the old sheets glue onto a company name. */
const NAME_SUFFIX_NOTE =
  /\s*\((PPO|2nd time|through [^)]+|summer internship\w*|hackathon based|cfg)\)\s*$/i;

function splitCompanyName(raw: string): { name: string; inlineNote: string | null } {
  let note: string | null = null;
  let text = raw.replace(/\s+/g, " ").trim();

  const suffix = NAME_SUFFIX_NOTE.exec(text);
  if (suffix) {
    note = suffix[1] ?? null;
    text = text.slice(0, suffix.index).trim();
  }

  const cleaned = cleanCompanyName(text);
  return {
    name: cleaned.name,
    inlineNote: [cleaned.inlineNote, note].filter(Boolean).join("; ") || null,
  };
}

function readRounds(
  sheet: Worksheet,
  row: number,
  columns: HistoricalColumns,
  window: SeasonWindow,
  context: { sheet: string; company: string },
  review: ReviewLog,
): ImportedRound[] {
  const rounds: ImportedRound[] = [];
  const sources: Array<[number | null, RoundKind, string]> = [
    [columns.testDate, "ONLINE_ASSESSMENT", "Test date"],
    [columns.interviewDate, "TECHNICAL_INTERVIEW", "Interview date"],
  ];

  let sequence = 1;
  for (const [column, kind, fieldName] of sources) {
    if (column === null) continue;
    const parsed = parseSheetDate(sheet.getCell(row, column).value, window);
    if (!parsed.raw || parsed.isNonDate) continue;

    if (parsed.isAmbiguous) {
      review.add({
        severity: "UNRESOLVED",
        sheet: context.sheet,
        row,
        company: context.company,
        field: fieldName,
        rawValue: parsed.raw,
        outcome: "Date left empty; raw text preserved on the round.",
        reason: parsed.note ?? "Could not resolve the date.",
      });
    }

    rounds.push({
      kind,
      mode: "UNKNOWN",
      sequence: sequence++,
      heldOn: parsed.isAmbiguous ? null : parsed.start,
      heldUntil: parsed.isAmbiguous ? null : parsed.end,
      rawSchedule: parsed.start && !parsed.note ? null : parsed.raw,
    });
  }

  return rounds;
}

function readTab(
  workbook: Workbook,
  tab: HistoricalTab,
  batchYear: number,
  window: SeasonWindow,
  review: ReviewLog,
): ImportedDrive[] {
  const sheet = workbook.getWorksheet(tab.sheet);
  if (!sheet) throw new Error(`Sheet "${tab.sheet}" not found in the ${batchYear} workbook.`);

  verifyHeaders(sheet, tab, batchYear);

  const cols = tab.columns;
  const drives: ImportedDrive[] = [];
  let current: ImportedDrive | null = null;
  let currentKey: string | null = null;

  // Tracks the previous role in the current block, so a run of rows that repeat
  // the same package and headcount (how these sheets write a block-wide figure)
  // is counted once rather than once per role.
  let lastComp: string | null = null;
  let lastHead: string | null = null;

  for (let row = tab.firstDataRow; row <= sheet.rowCount; row++) {
    const idText = cellText(sheet.getCell(row, cols.id));
    const companyText = cellText(sheet.getCell(row, cols.company));
    const roleText = cellText(sheet.getCell(row, cols.role));
    const noteText = cols.note === null ? null : cellText(sheet.getCell(row, cols.note));

    if (!idText && !companyText && !roleText && !noteText) continue;

    // A block is keyed on its "#" where it has one. A handful of rows (the
    // summer-conversion companies pinned to the top of the 2022 Tier-1 tab)
    // carry no "#"; there each distinct company name is its own block.
    const key = idText ? `#${idText}` : companyText ? `c:${companyText.toLowerCase()}` : null;
    const startsBlock = companyText !== null && key !== currentKey;

    if (startsBlock || current === null) {
      if (!companyText) {
        review.add({
          severity: "DROPPED",
          sheet: tab.sheet,
          row,
          company: null,
          field: "Company",
          rawValue: (roleText ?? noteText ?? "").slice(0, 200),
          outcome: "Row skipped: there is no company to attach it to.",
          reason: "The company cell held nothing readable and no open block precedes it.",
        });
        continue;
      }

      const { name, inlineNote } = splitCompanyName(companyText);
      const gpaCutoff = parseGpaCutoff(
        cols.gpaCutoff === null ? null : sheet.getCell(row, cols.gpaCutoff).value,
      );

      let pptDate: Date | null = null;
      if (cols.pptDate !== null) {
        const parsed = parseSheetDate(sheet.getCell(row, cols.pptDate).value, window);
        pptDate = parsed.isAmbiguous ? null : parsed.start;
      }

      current = {
        companyName: name,
        inlineNote,
        tierKey: tab.tierKey,
        cycle: tab.cycle,
        eligibleBranches: [],
        gpaCutoff,
        flags: {
          isRepeatCompany: false,
          hiredTenPlus: false,
          massHired: false,
          hiredNobody: false,
          ditched: false,
          isFooter: false,
        },
        pptDate,
        note: noteText,
        roles: [],
        sheet: tab.sheet,
        sheetRow: row,
      };
      drives.push(current);
      currentKey = key;
      lastComp = null;
      lastHead = null;

      if (gpaCutoff.isBranchSpecific) {
        review.add({
          severity: "DECIDED",
          sheet: tab.sheet,
          row,
          company: name,
          field: "GPA cutoff",
          rawValue: gpaCutoff.raw,
          outcome: `Stored ${gpaCutoff.numeric} as the general bar.`,
          reason: "The cutoff differs by branch; only one number can be stored numerically.",
        });
      }
    }

    if (!current) continue;

    const stipend = parseStipendCell(
      cols.stipend === null ? null : sheet.getCell(row, cols.stipend).value,
    );
    const base = parseAmountCell(cols.base === null ? null : sheet.getCell(row, cols.base).value);
    const ctc = parseAmountCell(cols.ctc === null ? null : sheet.getCell(row, cols.ctc).value);

    // A role shares the previous role's package when its compensation figures
    // are identical to it — the sheets repeat one advertised package down a
    // block's rows rather than merging the cell as 2026 does.
    const compTuple = `${stipend}|${base.value}|${ctc.value}`;
    const hasOwnFigure = stipend !== null || base.value !== null || ctc.value !== null;
    const sharesCompensation =
      current.roles.length > 0 && hasOwnFigure && compTuple === lastComp;

    let placedInternship = cols.placedInternship === null
      ? null
      : headcount(sheet.getCell(row, cols.placedInternship));
    let placedFte = cols.placedFte === null ? null : headcount(sheet.getCell(row, cols.placedFte));
    let placedBoth = cols.placedBoth === null ? null : headcount(sheet.getCell(row, cols.placedBoth));

    // When a role both shares its package AND repeats the previous row's
    // headcount, that figure is the block's, written again — not a second cohort.
    // Null it so the drive total is not inflated. A different headcount is a
    // genuine per-role number and is kept.
    const headTuple = `${placedInternship}|${placedFte}|${placedBoth}`;
    if (sharesCompensation && headTuple === lastHead) {
      placedInternship = null;
      placedFte = null;
      placedBoth = null;
    }
    lastComp = compTuple;
    lastHead = headTuple;

    const { components, unrecognised } = parseCompensationNote(noteText);
    for (const fragment of unrecognised) {
      review.add({
        severity: "DROPPED",
        sheet: tab.sheet,
        row,
        company: current.companyName,
        field: "Compensation note",
        rawValue: fragment.slice(0, 300),
        outcome: "Not turned into a compensation component; full note preserved.",
        reason: "Named a component with no readable amount, or an amount with no label.",
      });
    }

    // On the pinned no-# rows the "role" cell repeats the company name; that is
    // not a job title.
    const title = roleText && roleText !== companyText ? roleText : null;

    const role: ImportedRole = {
      title,
      stipendPerMonthInr: stipend,
      baseLpa: base.value,
      ctcLpa: ctc.value,
      sharesCompensationWithPrevious: sharesCompensation,
      disclosure: disclosureFor(stipend, base, ctc),
      compensationNote: noteText,
      components,
      placedInternship,
      placedFte,
      placedBoth,
      locations: parseLocations(noteText),
      bondMonths: parseBondMonths(noteText),
      internshipDurationMonths: parseInternshipMonths(noteText),
      note: noteText === current.note && current.roles.length === 0 ? null : noteText,
      rounds: readRounds(
        sheet,
        row,
        cols,
        window,
        { sheet: tab.sheet, company: current.companyName },
        review,
      ),
      sheetRow: row,
    };

    current.roles.push(role);
  }

  return drives;
}

export function readHistoricalWorkbook(
  workbook: Workbook,
  config: HistoricalConfig,
  review: ReviewLog,
): ImportedWorkbook {
  const window = seasonWindowForBatch(config.batchYear);
  const drives: ImportedDrive[] = [];

  for (const tab of config.tabs) {
    drives.push(...readTab(workbook, tab, config.batchYear, window, review));
  }

  // Tiers come from the tabs, exactly as in 2026. The old sheets have no footer
  // summary to re-derive, so no fidelity footers are produced.
  const footers: SheetFooterStats[] = [];
  return { batchYear: config.batchYear, drives, footers, deriveTierFromCtc: false };
}
