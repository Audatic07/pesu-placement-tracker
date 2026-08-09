import type { Cell, Workbook, Worksheet } from "exceljs";
import type { DisclosureStatus, OfferCycle, RoundKind } from "@/generated/prisma/enums";
import {
  companyFlagsFromFill,
  isBlockStart,
  isOwnCell,
  readFill,
  roundModeFromFill,
} from "../lib/colors";
import { parseSheetDate, seasonWindowForBatch, type SeasonWindow } from "../lib/dates";
import { parseAmountCell, parseCompensationNote } from "../lib/compensation";
import { parseGpaCutoff } from "../lib/gpa";
import { cleanCompanyName } from "../lib/companies";
import {
  parseBondMonths,
  parseEligibleBranches,
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
 * Reader for "Placement Scene '26.xlsx".
 *
 * Six tabs, four different column layouts, and meaning encoded in cell colour.
 * Each tab declares its layout below; the reader verifies the headers actually
 * match before reading a single row, so a reshuffled column produces a loud
 * failure rather than a database full of stipends in the CTC field.
 */

type ColumnLayout = {
  company: number;
  role: number;
  eligibleBranches: number | null;
  stipend: number;
  base: number | null;
  ctc: number | null;
  oaDate: number | null;
  interviewDate: number | null;
  presentationDate: number | null;
  placedInternship: number | null;
  placedFte: number | null;
  placedBoth: number | null;
  gpaCutoff: number | null;
  note: number;
};

type TabSpec = {
  sheet: string;
  /** First row containing data. */
  firstDataRow: number;
  /** Row whose cells are checked against `expectedHeaders`. */
  headerRow: number;
  expectedHeaders: Array<[number, RegExp]>;
  layout: ColumnLayout;
  tierKey: string | null;
  cycle: OfferCycle;
};

const TABS: TabSpec[] = [
  {
    sheet: "Tier 1",
    headerRow: 3,
    firstDataRow: 5,
    expectedHeaders: [
      [1, /^company$/i],
      [2, /^role$/i],
      [3, /eligible/i],
      [4, /internship/i],
      [5, /compensation/i],
      [7, /^oa date$/i],
      [8, /shortlisted/i],
      [9, /presentation/i],
      [10, /^placed$/i],
      [13, /gpa/i],
      [14, /^note$/i],
    ],
    layout: {
      company: 1,
      role: 2,
      eligibleBranches: 3,
      stipend: 4,
      base: 5,
      ctc: 6,
      oaDate: 7,
      interviewDate: 8,
      presentationDate: 9,
      placedInternship: 10,
      placedFte: 11,
      placedBoth: 12,
      gpaCutoff: 13,
      note: 14,
    },
    tierKey: "TIER_1",
    cycle: "FULL_TIME",
  },
  {
    sheet: "Tier 2",
    headerRow: 1,
    firstDataRow: 3,
    expectedHeaders: [
      [1, /^company$/i],
      [2, /^role$/i],
      [3, /eligible/i],
      [4, /internship/i],
      [5, /compensation/i],
      [7, /^oa date$/i],
      [8, /shortlisted/i],
      [9, /presentation/i],
      [10, /^placed$/i],
      [13, /gpa/i],
      [14, /^note$/i],
    ],
    layout: {
      company: 1,
      role: 2,
      eligibleBranches: 3,
      stipend: 4,
      base: 5,
      ctc: 6,
      oaDate: 7,
      interviewDate: 8,
      presentationDate: 9,
      placedInternship: 10,
      placedFte: 11,
      placedBoth: 12,
      gpaCutoff: 13,
      note: 14,
    },
    tierKey: "TIER_2",
    cycle: "FULL_TIME",
  },
  {
    // Tier 3 has no GPA column; the note sits one column earlier.
    sheet: "Tier 3",
    headerRow: 1,
    firstDataRow: 3,
    expectedHeaders: [
      [1, /^company$/i],
      [2, /^role$/i],
      [3, /eligible/i],
      [4, /internship/i],
      [5, /compensation/i],
      [7, /^oa date$/i],
      [8, /shortlisted/i],
      [9, /presentation/i],
      [10, /^placed$/i],
      [13, /^note$/i],
    ],
    layout: {
      company: 1,
      role: 2,
      eligibleBranches: 3,
      stipend: 4,
      base: 5,
      ctc: 6,
      oaDate: 7,
      interviewDate: 8,
      presentationDate: 9,
      placedInternship: 10,
      placedFte: 11,
      placedBoth: 12,
      gpaCutoff: null,
      note: 13,
    },
    tierKey: "TIER_3",
    cycle: "FULL_TIME",
  },
  {
    // "The companies that haven't declared their CTC's can't be classified into
    // any tiers and they are listed separately as intership only companies."
    // One placed column, no tier.
    sheet: "Internship Only",
    headerRow: 2,
    firstDataRow: 4,
    expectedHeaders: [
      [1, /^company$/i],
      [2, /^role$/i],
      [3, /eligible/i],
      [4, /internship/i],
      [5, /compensation/i],
      [7, /^oa date$/i],
      [8, /shortlisted/i],
      [9, /presentation/i],
      [10, /^placed$/i],
      [11, /^note$/i],
    ],
    layout: {
      company: 1,
      role: 2,
      eligibleBranches: 3,
      stipend: 4,
      base: 5,
      ctc: 6,
      oaDate: 7,
      interviewDate: 8,
      presentationDate: 9,
      placedInternship: 10,
      placedFte: null,
      placedBoth: null,
      gpaCutoff: null,
      note: 11,
    },
    tierKey: null,
    cycle: "SIX_MONTH_INTERNSHIP",
  },
  {
    // Summer internships that converted to pre-placement offers.
    sheet: "Summer Internship PPOs",
    headerRow: 1,
    firstDataRow: 3,
    expectedHeaders: [
      [1, /^company$/i],
      [2, /^role$/i],
      [3, /internship/i],
      [4, /compensation/i],
      [6, /^placed$/i],
      [8, /^note$/i],
    ],
    layout: {
      company: 1,
      role: 2,
      eligibleBranches: null,
      stipend: 3,
      base: 4,
      ctc: 5,
      oaDate: null,
      interviewDate: null,
      presentationDate: null,
      placedInternship: 6,
      placedFte: null,
      placedBoth: 7,
      gpaCutoff: null,
      note: 8,
    },
    tierKey: null,
    cycle: "SUMMER_INTERNSHIP",
  },
];

/** A row whose first column starts the footer summary block. */
const FOOTER_LABEL =
  /^(total visited|grand total|highest|average|median|wt\.|weighted|total placed)/i;

function cellText(cell: Cell): string | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;

  if (typeof value === "object" && value !== null) {
    // ExcelJS returns rich text and hyperlink objects for styled cells.
    if ("richText" in value && Array.isArray(value.richText)) {
      const text = value.richText.map((part) => part.text).join("");
      return text.trim() || null;
    }
    if ("text" in value && typeof value.text === "string") {
      return value.text.trim() || null;
    }
    if ("result" in value) {
      const result = (value as { result?: unknown }).result;
      return result === null || result === undefined ? null : String(result).trim() || null;
    }
    if (value instanceof Date) return value.toISOString();
  }

  const text = String(value).replace(/ /g, " ").trim();
  return text || null;
}

function cellNumber(cell: Cell): number | null {
  const value = cell.value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (typeof value === "object" && value !== null && "result" in value) {
    const result = (value as { result?: unknown }).result;
    if (typeof result === "number") return Number.isFinite(result) ? result : null;
  }

  const text = cellText(cell);
  if (!text) return null;
  const parsed = Number.parseFloat(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Headcount cells: 0 means "hired nobody", blank means "we don't know".
 *
 * Merge continuations return null. A "Placed: 40" cell merged across Deloitte's
 * eight role rows means forty students for the block, not forty per role.
 */
function headcount(sheet: Worksheet, row: number, column: number | null): number | null {
  if (column === null) return null;
  const cell = sheet.getCell(row, column);
  if (!isOwnCell(cell)) return null;
  const value = cell.value;
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cellText(cell);
  if (!text || text === "-") return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function verifyHeaders(sheet: Worksheet, spec: TabSpec): void {
  const problems: string[] = [];

  for (const [column, pattern] of spec.expectedHeaders) {
    const actual = cellText(sheet.getCell(spec.headerRow, column)) ?? "";
    if (!pattern.test(actual)) {
      problems.push(
        `  column ${column}: expected ${pattern} but found "${actual.replace(/\n/g, " ")}"`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Sheet "${spec.sheet}" does not have the expected layout — refusing to import ` +
        `rather than map columns wrongly.\n${problems.join("\n")}\n` +
        `If the sheet has legitimately changed, update TABS in scripts/import/sheets/scene2026.ts.`,
    );
  }
}

function readRounds(
  sheet: Worksheet,
  row: number,
  layout: ColumnLayout,
  window: SeasonWindow,
  context: { sheet: string; company: string },
  review: ReviewLog,
): ImportedRound[] {
  const rounds: ImportedRound[] = [];

  const sources: Array<[number | null, RoundKind, string]> = [
    [layout.oaDate, "ONLINE_ASSESSMENT", "OA date"],
    [layout.interviewDate, "TECHNICAL_INTERVIEW", "Interview date"],
  ];

  let sequence = 1;
  for (const [column, kind, fieldName] of sources) {
    if (column === null) continue;

    const cell = sheet.getCell(row, column);
    const parsed = parseSheetDate(cell.value, window);
    if (!parsed.raw) continue;

    // The green/pink fill on this cell is the round's mode. That information
    // exists nowhere else in the workbook.
    const mode = roundModeFromFill(readFill(cell));

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
    } else if (parsed.note) {
      review.add({
        severity: "DECIDED",
        sheet: context.sheet,
        row,
        company: context.company,
        field: fieldName,
        rawValue: parsed.raw,
        outcome: parsed.start ? parsed.start.toISOString().slice(0, 10) : "(none)",
        reason: parsed.note,
      });
    }

    rounds.push({
      kind,
      mode,
      sequence: sequence++,
      heldOn: parsed.isAmbiguous ? null : parsed.start,
      heldUntil: parsed.isAmbiguous ? null : parsed.end,
      rawSchedule: parsed.start && !parsed.note ? null : parsed.raw,
    });
  }

  return rounds;
}

function disclosureFor(
  stipend: ReturnType<typeof parseAmountCell>,
  base: ReturnType<typeof parseAmountCell>,
  ctc: ReturnType<typeof parseAmountCell>,
): DisclosureStatus {
  if (base.isPerformanceBased || ctc.isPerformanceBased || stipend.isPerformanceBased) {
    return "PERFORMANCE_BASED";
  }
  if (ctc.value !== null) return base.value !== null ? "DISCLOSED" : "PARTIAL";
  if (base.value !== null || stipend.value !== null) return "PARTIAL";
  return "NOT_DISCLOSED";
}

function readTab(
  workbook: Workbook,
  spec: TabSpec,
  window: SeasonWindow,
  review: ReviewLog,
): { drives: ImportedDrive[]; footer: SheetFooterStats } {
  const sheet = workbook.getWorksheet(spec.sheet);
  if (!sheet) {
    throw new Error(`Sheet "${spec.sheet}" not found in the workbook.`);
  }

  verifyHeaders(sheet, spec);

  const drives: ImportedDrive[] = [];
  let current: ImportedDrive | null = null;
  let footerStartRow: number | null = null;

  for (let row = spec.firstDataRow; row <= sheet.rowCount; row++) {
    const companyCell = sheet.getCell(row, spec.layout.company);
    const companyText = cellText(companyCell);
    const fill = readFill(companyCell);
    const flags = companyFlagsFromFill(fill);

    // Stop at the summary block: it is styled navy and starts with a total.
    if (flags.isFooter || (companyText && FOOTER_LABEL.test(companyText))) {
      footerStartRow = row;
      break;
    }

    const roleText = cellText(sheet.getCell(row, spec.layout.role));
    const noteText = cellText(sheet.getCell(row, spec.layout.note));

    // A row with no company, role or note carries nothing.
    if (!companyText && !roleText && !noteText) continue;

    const startsBlock = isBlockStart(companyCell) && companyText !== null;

    if (startsBlock || current === null) {
      if (!companyText) continue;

      const { name, inlineNote } = cleanCompanyName(companyText);
      const gpaCell =
        spec.layout.gpaCutoff === null
          ? null
          : sheet.getCell(row, spec.layout.gpaCutoff);
      const gpaCutoff = parseGpaCutoff(gpaCell ? gpaCell.value : null);

      let pptDate: Date | null = null;
      if (spec.layout.presentationDate !== null) {
        const parsed = parseSheetDate(
          sheet.getCell(row, spec.layout.presentationDate).value,
          window,
        );
        pptDate = parsed.isAmbiguous ? null : parsed.start;
      }

      current = {
        companyName: name,
        inlineNote,
        tierKey: spec.tierKey,
        cycle: spec.cycle,
        eligibleBranches: parseEligibleBranches(
          spec.layout.eligibleBranches === null
            ? null
            : cellText(sheet.getCell(row, spec.layout.eligibleBranches)),
        ),
        gpaCutoff,
        flags,
        pptDate,
        note: noteText,
        roles: [],
        sheet: spec.sheet,
        sheetRow: row,
      };
      drives.push(current);

      if (gpaCutoff.isBranchSpecific) {
        review.add({
          severity: "DECIDED",
          sheet: spec.sheet,
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

    // Compensation is read from own cells only, so a merged figure is counted
    // once — see isOwnCell.
    const readAmount = (column: number | null) => {
      if (column === null) return parseAmountCell(null);
      const cell = sheet.getCell(row, column);
      return isOwnCell(cell) ? parseAmountCell(cell.value) : parseAmountCell(null);
    };

    const stipend = readAmount(spec.layout.stipend);
    const base = readAmount(spec.layout.base);
    const ctc = readAmount(spec.layout.ctc);

    // A role shares the previous role's package only when it contributes NO
    // figure of its own. Thales Group's "SW Solution" inherits a merged stipend
    // but states its own CTC of 8 — treating it as a shared package silently
    // replaced that 8 with the sibling role's 9.
    const compensationColumns = [spec.layout.stipend, spec.layout.base, spec.layout.ctc].filter(
      (column): column is number => column !== null,
    );
    const hasMergedCell = compensationColumns.some(
      (column) => !isOwnCell(sheet.getCell(row, column)),
    );
    const hasOwnFigure =
      stipend.value !== null || base.value !== null || ctc.value !== null;
    const sharesCompensation = current.roles.length > 0 && hasMergedCell && !hasOwnFigure;

    const { components, unrecognised } = parseCompensationNote(noteText);

    for (const fragment of unrecognised) {
      review.add({
        severity: "DROPPED",
        sheet: spec.sheet,
        row,
        company: current.companyName,
        field: "Compensation note",
        rawValue: fragment.slice(0, 300),
        outcome: "Not turned into a compensation component; full note preserved.",
        reason: "Named a component with no readable amount, or an amount with no label.",
      });
    }

    if (ctc.qualifier && ctc.value !== null) {
      review.add({
        severity: "DECIDED",
        sheet: spec.sheet,
        row,
        company: current.companyName,
        field: "CTC",
        rawValue: ctc.raw,
        outcome: `Stored ${ctc.value} LPA.`,
        reason: `Cell carried the qualifier "${ctc.qualifier}".`,
      });
    }

    if (ctc.additional !== null) {
      review.add({
        severity: "DECIDED",
        sheet: spec.sheet,
        row,
        company: current.companyName,
        field: "CTC",
        rawValue: ctc.raw,
        outcome: `Stored ${ctc.value} LPA base with ${ctc.additional} recorded separately.`,
        reason: "Cell was written as a figure plus an explicit extra.",
      });
    }

    const role: ImportedRole = {
      title: roleText,
      stipendPerMonthInr: stipend.value,
      baseLpa: base.value,
      ctcLpa: ctc.value,
      sharesCompensationWithPrevious: sharesCompensation,
      disclosure: disclosureFor(stipend, base, ctc),
      compensationNote: noteText,
      components,
      placedInternship: headcount(sheet, row, spec.layout.placedInternship),
      placedFte: headcount(sheet, row, spec.layout.placedFte),
      placedBoth: headcount(sheet, row, spec.layout.placedBoth),
      locations: parseLocations(noteText),
      bondMonths: parseBondMonths(noteText),
      internshipDurationMonths: parseInternshipMonths(noteText),
      note: noteText === current.note && current.roles.length === 0 ? null : noteText,
      rounds: readRounds(
        sheet,
        row,
        spec.layout,
        window,
        { sheet: spec.sheet, company: current.companyName },
        review,
      ),
      sheetRow: row,
    };

    // A row with an explicit extra ("10 (+1)") records the extra as a component
    // so the headline figure and the true total stay distinguishable.
    if (ctc.additional !== null) {
      role.components.push({
        kind: "OTHER",
        amount: ctc.additional,
        currency: "INR",
        isLpa: true,
        isOneTime: false,
        isCash: true,
        vestingYears: null,
        note: `Recorded in the CTC cell as "${ctc.raw}".`,
      });
    }

    current.roles.push(role);
  }

  const footer = readFooter(sheet, spec.sheet, footerStartRow);
  return { drives, footer };
}

/**
 * Reads the summary block each tab computes for itself. These are the numbers
 * the import is checked against — see scripts/import/verify.ts.
 */
function readFooter(
  sheet: Worksheet,
  sheetName: string,
  startRow: number | null,
): SheetFooterStats {
  const stats: SheetFooterStats = {
    sheet: sheetName,
    companiesVisited: null,
    placedInternship: null,
    placedFte: null,
    placedBoth: null,
    placedTotal: null,
    highestCtc: null,
    averageCtc: null,
    medianCtc: null,
    weightedAverageCtc: null,
    weightedMedianCtc: null,
    highestBase: null,
    averageBase: null,
    medianBase: null,
    highestStipend: null,
    averageStipend: null,
    medianStipend: null,
    companiesWithTenPlus: null,
    massRecruiters: null,
    ditchedCompanies: null,
    repeatCompanies: null,
  };

  if (startRow === null) return stats;

  // Scan by label rather than by fixed offset: the summary block sits at a
  // different row on every tab and has moved between revisions of the sheet.
  for (let row = startRow; row <= Math.min(startRow + 20, sheet.rowCount); row++) {
    for (let column = 1; column <= 12; column++) {
      const label = cellText(sheet.getCell(row, column));
      if (!label) continue;

      const nextNumber = (offset: number) => cellNumber(sheet.getCell(row, column + offset));

      if (/^total visited$/i.test(label)) stats.companiesVisited = nextNumber(1);
      else if (/^total placed/i.test(label)) {
        stats.placedInternship = nextNumber(1);
        stats.placedFte = nextNumber(2);
        stats.placedBoth = nextNumber(3);
      } else if (/^grand total$/i.test(label)) stats.placedTotal = nextNumber(1);
      else if (/^highest (ctc|package)$/i.test(label)) stats.highestCtc = nextNumber(1);
      else if (/^average (ctc|package)$/i.test(label)) stats.averageCtc = nextNumber(1);
      else if (/^median (ctc|package)$/i.test(label)) stats.medianCtc = nextNumber(1);
      else if (/^wt\.? ?(average|avg) ctc$/i.test(label)) stats.weightedAverageCtc = nextNumber(1);
      else if (/^wt\.? ?median ctc$/i.test(label)) stats.weightedMedianCtc = nextNumber(1);
      else if (/^highest base$/i.test(label)) stats.highestBase = nextNumber(1);
      else if (/^average base$/i.test(label)) stats.averageBase = nextNumber(1);
      else if (/^median base$/i.test(label)) stats.medianBase = nextNumber(1);
      else if (/^highest stipend$/i.test(label)) stats.highestStipend = nextNumber(1);
      else if (/^average stipend$/i.test(label)) stats.averageStipend = nextNumber(1);
      else if (/^median stipend$/i.test(label)) stats.medianStipend = nextNumber(1);
      else if (/companies with 10\+/i.test(label)) stats.companiesWithTenPlus = nextNumber(2);
      else if (/mass recruitment companies/i.test(label)) stats.massRecruiters = nextNumber(2);
      else if (/companies that ditched/i.test(label)) stats.ditchedCompanies = nextNumber(2);
      else if (/^repeat companies$/i.test(label)) stats.repeatCompanies = nextNumber(2);
    }
  }

  return stats;
}

export function readScene2026(workbook: Workbook, review: ReviewLog): ImportedWorkbook {
  const batchYear = 2026;
  const window = seasonWindowForBatch(batchYear);

  const drives: ImportedDrive[] = [];
  const footers: SheetFooterStats[] = [];

  for (const spec of TABS) {
    const result = readTab(workbook, spec, window, review);
    drives.push(...result.drives);
    footers.push(result.footer);
  }

  // Tiers come from the tabs. A role with no tier here has none by design.
  return { batchYear, drives, footers, deriveTierFromCtc: false };
}
