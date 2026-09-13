import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readScene2027 } from "./scene2027";
import { ReviewLog } from "../lib/review";

/**
 * The 2027 workbook is not in the repo, so these build the parts of its layout
 * that the reader makes decisions about. Every fill and every row position here
 * was transcribed from the real sheet.
 */

const NAVY = "FF073763";
const ORDINARY = "FFCFE2F3";
const PURPLE = "FF8E7CC3";
const ORANGE = "FFF6B26B";
const RED = "FFEA4335";
const BLACK = "FF000000";
const PPO_PINK = "FFC27BA0";

function paint(cell: ExcelJS.Cell, argb: string): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

/** A workbook with 2027's header block and whatever data rows are given. */
function build(
  rows: Array<{ row: number; values: Array<[number, unknown]>; fill?: string }>,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Total");

  const header: Array<[number, string]> = [
    [1, "Company"],
    [2, "Role"],
    [3, "Eligible Branches"],
    [4, "Internship"],
    [5, "Compensation (LPA)"],
    [7, "OA Date"],
    [8, "Shortlisted Interview"],
    [9, "Presentation"],
    [10, "Placed"],
    [13, "GPA Cutoff"],
    [14, "Note"],
  ];
  for (const [column, text] of header) sheet.getCell(6, column).value = text;

  for (const spec of rows) {
    for (const [column, value] of spec.values) {
      sheet.getCell(spec.row, column).value = value as ExcelJS.CellValue;
    }
    if (spec.fill) paint(sheet.getCell(spec.row, 1), spec.fill);
  }

  return workbook;
}

function read(workbook: ExcelJS.Workbook) {
  return readScene2027(workbook, new ReviewLog());
}

describe("readScene2027", () => {
  it("refuses a workbook whose columns have shifted, naming its own config file", () => {
    const workbook = build([]);
    workbook.getWorksheet("Total")!.getCell(6, 2).value = "Designation";

    expect(() => read(workbook)).toThrow(/scripts\/import\/sheets\/scene2027\.ts/);
    expect(() => read(workbook)).toThrow(/column 2/);
  });

  it("stops at the PPO summary line instead of reading it as a company", () => {
    const workbook = build([
      { row: 9, values: [[1, "Eternal(Zomato)"], [2, "SDE I"], [12, 3]], fill: ORDINARY },
      {
        row: 11,
        values: [
          [1, "PPO OFFERED STUDENTS"],
          [2, "info as of 4/08/2026 — may have changed."],
          [12, 14],
        ],
        fill: PPO_PINK,
      },
      { row: 13, values: [[1, "Total Visited"], [2, 55]], fill: NAVY },
    ]);

    const parsed = read(workbook);

    expect(parsed.drives.map((drive) => drive.companyName)).toEqual(["Eternal(Zomato)"]);
    // The fourteen PPOs are a published aggregate, not a company that hired.
    // Read as data they would become fourteen offer rows at a firm that does
    // not exist, and the directory would list it.
    const placed = parsed.drives.flatMap((drive) =>
      drive.roles.map((role) => role.placedBoth),
    );
    expect(placed).toEqual([3]);
  });

  it("does not read 2027's black as 'hired nobody' — its legend says the opposite", () => {
    const workbook = build([
      {
        row: 9,
        values: [[1, "Infosys"], [2, "Specialist Programmer L3"], [10, "DATA NOT AVAIL"]],
        fill: BLACK,
      },
    ]);

    const drive = read(workbook).drives[0]!;

    // 2026 paints this swatch on companies that interviewed and hired nobody,
    // and load.ts writes those up as an outcome of NO_HIRES. Here it means the
    // sheet does not know, which is not a fact about the company at all.
    expect(drive.flags.hiredNobody).toBe(false);
    expect(drive.roles[0]!.placedInternship).toBeNull();
  });

  it("reads the flags 2027 does define, from 2027's own swatches", () => {
    const workbook = build([
      { row: 9, values: [[1, "HPE (part of CPP)"], [2, "AI Engineer"]], fill: PURPLE },
      { row: 10, values: [[1, "Vyapar Apps"], [2, "SDE"], [12, 11]], fill: ORANGE },
      { row: 11, values: [[1, "SIXT R&D"], [2, "SDE"]], fill: RED },
    ]);

    const byName = new Map(read(workbook).drives.map((d) => [d.companyName, d.flags]));

    expect(byName.get("HPE (part of CPP)")?.isRepeatCompany).toBe(true);
    expect(byName.get("Vyapar Apps")?.hiredTenPlus).toBe(true);
    // Red, not 2026's theme 5.
    expect(byName.get("SIXT R&D")?.ditched).toBe(true);
    // No colour in this legend means more than 25 hires.
    expect(byName.get("Vyapar Apps")?.massHired).toBe(false);
  });

  it("counts a headcount merged across a company's roles once", () => {
    const workbook = build([
      { row: 9, values: [[1, "Ather Energy"], [2, "Firmware"], [12, 1]], fill: ORDINARY },
      { row: 10, values: [[2, "Hardware Circuits"]] },
      { row: 11, values: [[2, "AI Intern"]] },
    ]);
    const sheet = workbook.getWorksheet("Total")!;
    sheet.mergeCells(9, 1, 11, 1);
    sheet.mergeCells(9, 12, 11, 12);

    const drive = read(workbook).drives[0]!;

    expect(drive.roles).toHaveLength(3);
    // One "1" spanning three role rows is one student, not three.
    expect(drive.roles.map((role) => role.placedBoth)).toEqual([1, null, null]);
  });

  it("carries the season's published totals through for verification", () => {
    const workbook = build([
      { row: 9, values: [[1, "Eternal(Zomato)"], [2, "SDE I"], [12, 3]], fill: ORDINARY },
      {
        row: 11,
        values: [
          [1, "Total Visited"],
          [2, 55],
          [9, "Total Placed(T1)"],
          [10, 40],
          [12, 151],
        ],
        fill: NAVY,
      },
    ]);

    const footer = read(workbook).footers[0]!;

    expect(footer.companiesVisited).toBe(55);
    expect(footer.placedInternship).toBe(40);
    expect(footer.placedBoth).toBe(151);
  });
});
