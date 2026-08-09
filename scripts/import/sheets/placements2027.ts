import type { Cell, Workbook } from "exceljs";
import type { RoundKind } from "@/generated/prisma/enums";
import { isBlockStart, isOwnCell, readFill, roundModeFromFill } from "../lib/colors";
import { parseSheetDate, seasonWindowForBatch } from "../lib/dates";
import { parseAmountCell, parseCompensationNote } from "../lib/compensation";
import { parseGpaCutoff } from "../lib/gpa";
import { cleanCompanyName } from "../lib/companies";
import { parseBondMonths, parseInternshipMonths, parseLocations } from "../lib/roles";
import type { ReviewLog } from "../lib/review";
import type { ImportedDrive, ImportedRole, ImportedRound, ImportedWorkbook } from "./types";

/**
 * Reader for "Placements 27 .xlsx".
 *
 * A different, simpler layout than the 2026 workbook: one flat sheet, no tier
 * tabs, no eligible-branches column (the title states the whole sheet is "CSE
 * and AIML related roles only"), and separate PPT / OA / Interview date
 * columns that the 2026 sheet folded together.
 *
 * Because there are no tier tabs, tier is left null here and resolved from the
 * CTC against the batch's TierConfig at load time.
 *
 *   A Company   B Role   C Internship(stipend)   D CTC (LPA)
 *   E Placed:Internship  F Placed:FTE  G Placed:Both
 *   H GPA Cutoff   I Note   J PPT date   K OA date   L Interview date
 */

const SHEET = "Sheet1";
const HEADER_ROW = 2;
const FIRST_DATA_ROW = 4;

const COLUMNS = {
  company: 1,
  role: 2,
  stipend: 3,
  ctc: 4,
  placedInternship: 5,
  placedFte: 6,
  placedBoth: 7,
  gpaCutoff: 8,
  note: 9,
  pptDate: 10,
  oaDate: 11,
  interviewDate: 12,
} as const;

const EXPECTED_HEADERS: Array<[number, RegExp]> = [
  [1, /^company$/i],
  [2, /^role$/i],
  [3, /^internship$/i],
  [4, /^compensation$/i],
  [5, /^placed$/i],
  [8, /gpa/i],
  [9, /^note$/i],
  [10, /ppt/i],
  [11, /^oa date$/i],
  [12, /interview date/i],
];

function cellText(cell: Cell): string | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;

  if (typeof value === "object" && value !== null) {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("").trim() || null;
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

  return String(value).replace(/ /g, " ").trim() || null;
}

function headcount(cell: Cell): number | null {
  if (!isOwnCell(cell)) return null;
  const value = cell.value;
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cellText(cell);
  if (!text || text === "-") return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readPlacements2027(workbook: Workbook, review: ReviewLog): ImportedWorkbook {
  const sheet = workbook.getWorksheet(SHEET);
  if (!sheet) throw new Error(`Sheet "${SHEET}" not found in the 2027 workbook.`);

  const problems: string[] = [];
  for (const [column, pattern] of EXPECTED_HEADERS) {
    const actual = cellText(sheet.getCell(HEADER_ROW, column)) ?? "";
    if (!pattern.test(actual)) {
      problems.push(`  column ${column}: expected ${pattern} but found "${actual}"`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `The 2027 sheet does not have the expected layout — refusing to import.\n` +
        `${problems.join("\n")}\n` +
        `If the sheet has legitimately changed, update scripts/import/sheets/placements2027.ts.`,
    );
  }

  const batchYear = 2027;
  const window = seasonWindowForBatch(batchYear);
  const drives: ImportedDrive[] = [];
  let current: ImportedDrive | null = null;

  for (let row = FIRST_DATA_ROW; row <= sheet.rowCount; row++) {
    const companyCell = sheet.getCell(row, COLUMNS.company);
    const companyText = cellText(companyCell);
    const roleText = cellText(sheet.getCell(row, COLUMNS.role));
    const noteText = cellText(sheet.getCell(row, COLUMNS.note));

    if (!companyText && !roleText && !noteText) continue;

    if (isBlockStart(companyCell) && companyText) {
      const { name, inlineNote } = cleanCompanyName(companyText);
      const pptParsed = parseSheetDate(sheet.getCell(row, COLUMNS.pptDate).value, window);

      current = {
        companyName: name,
        inlineNote,
        // No tier tabs on this sheet: resolved from the CTC at load time.
        tierKey: null,
        cycle: "FULL_TIME",
        // The sheet title says the whole thing is "CSE and AIML related roles only".
        eligibleBranches: ["CSE", "AIML"],
        gpaCutoff: parseGpaCutoff(sheet.getCell(row, COLUMNS.gpaCutoff).value),
        flags: {
          isRepeatCompany: false,
          hiredTenPlus: false,
          massHired: false,
          hiredNobody: false,
          // The 2027 sheet says so in words rather than in colour.
          ditched: /did not proceed/i.test(companyText),
          isFooter: false,
        },
        pptDate: pptParsed.isAmbiguous ? null : pptParsed.start,
        note: noteText,
        roles: [],
        sheet: "Placements 27",
        sheetRow: row,
      };
      drives.push(current);
    }

    if (!current) continue;

    // Own cells only — a merged package across role rows is one shared package.
    const stipendCell = sheet.getCell(row, COLUMNS.stipend);
    const ctcCell = sheet.getCell(row, COLUMNS.ctc);

    const stipend = isOwnCell(stipendCell)
      ? parseAmountCell(stipendCell.value)
      : parseAmountCell(null);
    const ctc = isOwnCell(ctcCell) ? parseAmountCell(ctcCell.value) : parseAmountCell(null);

    // Shares only when it contributes no figure of its own — see scene2026.ts.
    const sharesCompensation =
      current.roles.length > 0 &&
      (!isOwnCell(stipendCell) || !isOwnCell(ctcCell)) &&
      stipend.value === null &&
      ctc.value === null;
    const { components, unrecognised } = parseCompensationNote(noteText);

    for (const fragment of unrecognised) {
      review.add({
        severity: "DROPPED",
        sheet: "Placements 27",
        row,
        company: current.companyName,
        field: "Compensation note",
        rawValue: fragment.slice(0, 300),
        outcome: "Not turned into a compensation component; full note preserved.",
        reason: "Named a component with no readable amount, or an amount with no label.",
      });
    }

    const rounds: ImportedRound[] = [];
    let sequence = 1;
    const roundSources: Array<[number, RoundKind, string]> = [
      [COLUMNS.oaDate, "ONLINE_ASSESSMENT", "OA date"],
      [COLUMNS.interviewDate, "TECHNICAL_INTERVIEW", "Interview date"],
    ];

    for (const [column, kind, fieldName] of roundSources) {
      const cell = sheet.getCell(row, column);
      const parsed = parseSheetDate(cell.value, window);
      if (!parsed.raw) continue;

      if (parsed.isAmbiguous) {
        review.add({
          severity: "UNRESOLVED",
          sheet: "Placements 27",
          row,
          company: current.companyName,
          field: fieldName,
          rawValue: parsed.raw,
          outcome: "Date left empty; raw text preserved on the round.",
          reason: parsed.note ?? "Could not resolve the date.",
        });
      }

      rounds.push({
        kind,
        mode: roundModeFromFill(readFill(cell)),
        sequence: sequence++,
        heldOn: parsed.isAmbiguous ? null : parsed.start,
        heldUntil: parsed.isAmbiguous ? null : parsed.end,
        rawSchedule: parsed.start && !parsed.note ? null : parsed.raw,
      });
    }

    const role: ImportedRole = {
      title: roleText,
      stipendPerMonthInr: stipend.value,
      baseLpa: null,
      ctcLpa: ctc.value,
      sharesCompensationWithPrevious: sharesCompensation,
      disclosure: ctc.isPerformanceBased
        ? "PERFORMANCE_BASED"
        : ctc.value !== null
          ? "PARTIAL"
          : ctc.isUndisclosed
            ? "NOT_DISCLOSED"
            : "NOT_DISCLOSED",
      compensationNote: noteText,
      components,
      placedInternship: headcount(sheet.getCell(row, COLUMNS.placedInternship)),
      placedFte: headcount(sheet.getCell(row, COLUMNS.placedFte)),
      placedBoth: headcount(sheet.getCell(row, COLUMNS.placedBoth)),
      locations: parseLocations(noteText),
      bondMonths: parseBondMonths(noteText),
      internshipDurationMonths: parseInternshipMonths(noteText),
      note: noteText,
      rounds,
      sheetRow: row,
    };

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

  // This sheet has no tier tabs, so tiers are derived from the CTC at load time.
  return { batchYear, drives, footers: [], deriveTierFromCtc: true };
}
