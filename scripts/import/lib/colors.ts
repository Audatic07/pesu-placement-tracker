import type { Cell, FillPattern } from "exceljs";
import type { RoundMode } from "@/generated/prisma/enums";

/**
 * The spreadsheets encode real information as cell fill colour. A copy-paste
 * would destroy all of it, which is a large part of why this import exists.
 *
 * From the legend row of the Tier 1 sheet, verified against the actual fills:
 *
 *   FFB4A7D6  purple       repeat company — came to hire more than once
 *   FFB6D7A8  green        that round was conducted online
 *   FFF4CCCC  pink         that round was conducted in person
 *   FFFCE5CD  light orange hired 10 or more students
 *   theme 5   red          did not proceed with the hiring process
 *   FFFFD966  yellow       mass hire, more than 25 students
 *   FF000000  black        took interviews but hired nobody
 *
 * Two further fills appear in the data but not the legend:
 *
 *   FFCFE2F3  light blue   an ordinary company row, no special meaning
 *   FF073763  dark navy    the footer summary block — NOT a data row
 *
 * Only the first row of a merged company block carries the fill; continuation
 * rows come back with pattern "none". Read the colour at the block start.
 */

export const FILL = {
  REPEAT_COMPANY: "FFB4A7D6",
  ROUND_ONLINE: "FFB6D7A8",
  ROUND_IN_PERSON: "FFF4CCCC",
  HIRED_TEN_PLUS: "FFFCE5CD",
  MASS_HIRED: "FFFFD966",
  NO_HIRES: "FF000000",
  ORDINARY: "FFCFE2F3",
  FOOTER: "FF073763",
  WHITE: "FFFFFFFF",
} as const;

/** The theme index the workbook uses for "didn't proceed with hiring". */
export const DITCHED_THEME = 5;

export type FillSignature = {
  argb: string | null;
  theme: number | null;
};

export function readFill(cell: Cell): FillSignature {
  const fill = cell.fill as FillPattern | undefined;
  if (!fill || fill.type !== "pattern" || fill.pattern !== "solid") {
    return { argb: null, theme: null };
  }
  const fg = fill.fgColor;
  return {
    argb: typeof fg?.argb === "string" ? fg.argb.toUpperCase() : null,
    theme: typeof fg?.theme === "number" ? fg.theme : null,
  };
}

export type CompanyFlags = {
  isRepeatCompany: boolean;
  hiredTenPlus: boolean;
  massHired: boolean;
  /** Ran a process and hired nobody. Different from "we don't know". */
  hiredNobody: boolean;
  /** Announced, then never ran the process. */
  ditched: boolean;
  /** The dark navy summary block at the bottom of each sheet. */
  isFooter: boolean;
};

export function companyFlagsFromFill(fill: FillSignature): CompanyFlags {
  return {
    isRepeatCompany: fill.argb === FILL.REPEAT_COMPANY,
    hiredTenPlus: fill.argb === FILL.HIRED_TEN_PLUS,
    massHired: fill.argb === FILL.MASS_HIRED,
    hiredNobody: fill.argb === FILL.NO_HIRES,
    ditched: fill.theme === DITCHED_THEME,
    isFooter: fill.argb === FILL.FOOTER,
  };
}

export function roundModeFromFill(fill: FillSignature): RoundMode {
  if (fill.argb === FILL.ROUND_ONLINE) return "ONLINE";
  if (fill.argb === FILL.ROUND_IN_PERSON) return "IN_PERSON";
  return "UNKNOWN";
}

/**
 * True when this row begins a new company block.
 *
 * ExcelJS resolves merged cells for us — reading A41 inside the merge A40:A44
 * returns "Apple" — so forward-fill is free. What we still need to know is
 * where a block *starts*, because that is the row carrying the fill colour and
 * the row whose values apply to the whole block.
 */
export function isBlockStart(cell: Cell): boolean {
  return isOwnCell(cell);
}

/**
 * True when the cell holds its own value rather than inheriting one from a
 * merge it is part of.
 *
 * This distinction is not cosmetic. ExcelJS resolves merged cells, so reading
 * F5:F7 where only F5 carries a value returns that value three times — while
 * the spreadsheet's own AVERAGE counts it once. Treating every row as a
 * separate data point inflated the imported Tier 1 average from 20.90 to 21.40
 * and the "placed" totals by fifty-odd students. Anything that will be summed,
 * averaged or counted must read own cells only.
 */
export function isOwnCell(cell: Cell): boolean {
  if (!cell.isMerged) return true;
  return cell.master?.address === cell.address;
}
