import type { Workbook } from "exceljs";
import { readColourCodedWorkbook, type TabSpec } from "./scene2026";
import type { CompanyPalette } from "../lib/colors";
import type { ReviewLog } from "../lib/review";
import type { ImportedWorkbook } from "./types";

/**
 * Reader for the 2027 "Placement Scene" workbook.
 *
 * Same colour-coded format as 2026 — merged company blocks, meaning in cell
 * fill — so this file is a layout and nothing else; `readColourCodedWorkbook`
 * does the reading. Three things differ from 2026 and all three are declared
 * below rather than coded around:
 *
 *  - One tab, named "Total", instead of six tiered ones. The sheet does not
 *    tier its companies, so no role gets a tier. `deriveTierFromCtc` stays off:
 *    a tier this workbook never states is not one the importer gets to invent
 *    from a CTC threshold.
 *  - A two-row header (6 and 7) with the second row splitting Compensation into
 *    Base/CTC and Placed into Internship/FTE/Both. Only row 6 is verified; the
 *    column numbers those splits land on are the same as 2026's, and row 7 is
 *    checked by the same column map being right about them.
 *  - A "PPO OFFERED STUDENTS" summary line above the navy total. See below.
 *
 * And a fourth thing that is not a layout difference at all: the palette. See
 * PALETTE_2027.
 */

/**
 * 2027's colour legend, transcribed from the legend row (row 3) of the sheet
 * itself rather than assumed from 2026:
 *
 *   FF8E7CC3  purple        repeat company — came to hire multiple times
 *   FFB6D7A8  green         that round was conducted online
 *   FFF4CCCC  pink          that round was conducted in person
 *   FFF6B26B  orange        hired 10 or more students
 *   FFEA4335  red           didn't proceed with the hiring process
 *   FF000000  black         information not available
 *   FFCFE2F3  light blue    an ordinary company row
 *   FF073763  dark navy     the footer summary block
 *
 * The round colours, the ordinary fill and the footer navy are the only four
 * this season shares with 2026. Every company flag is a different swatch, and
 * two need saying out loud:
 *
 * `ditched` is a plain red here. 2026 encodes it as theme 5, which is why the
 * palette carries both spellings — the same meaning, stored two ways by two
 * cohorts of the same template.
 *
 * `hiredNobody` is null, and that is the important one. 2027 paints black on
 * Kickdrum and the four Infosys roles, and its legend calls that "information
 * not available" — the same swatch 2026 uses for "took interviews and hired
 * nobody". Inheriting 2026's reading would publish an absence of knowledge as
 * knowledge of an absence, and `outcomeFor` in load.ts would write those five
 * drives up as NO_HIRES. Their placed cells say "DATA NOT AVAIL", which the
 * headcount reader already turns into null and therefore into no offer rows.
 * The sheet's not knowing is recorded by that null, not by a flag.
 *
 * There is no mass-hire colour in this legend, so `massHired` is null too.
 */
const PALETTE_2027: CompanyPalette = {
  repeatCompany: "FF8E7CC3",
  hiredTenPlus: "FFF6B26B",
  massHired: null,
  hiredNobody: null,
  ditched: { argb: "FFEA4335", theme: null },
};

/**
 * 2027 closes its data with a summary line 2026 has no equivalent of:
 *
 *     PPO OFFERED STUDENTS | info as of 4/08/2026 — may have changed | … | 14
 *
 * It is pink rather than navy and its label is not a "total", so neither of the
 * two things that stop a tab would stop this one. Read as data it becomes a
 * company called "PPO OFFERED STUDENTS" with fourteen students placed at it.
 *
 * Worth knowing when reconciling: the sheet's own `COUNTA(A9:A82)` and
 * `SUM(L9:L82)` both reach past this row, so the published "Total Visited" of 55
 * counts it as a company and the published 151 includes its 14. The footer check
 * in verify.ts is told about that below.
 */
const FOOTER_LABEL_2027 = /^(ppo offered students|total visited|grand total|total placed)/i;

const TABS: TabSpec[] = [
  {
    sheet: "Total",
    headerRow: 6,
    firstDataRow: 9,
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
    footerLabel: FOOTER_LABEL_2027,
    tierKey: null,
    cycle: "FULL_TIME",
  },
];

export function readScene2027(workbook: Workbook, review: ReviewLog): ImportedWorkbook {
  return readColourCodedWorkbook(
    workbook,
    {
      batchYear: 2027,
      tabs: TABS,
      emitFooters: true,
      deriveTierFromCtc: false,
      palette: PALETTE_2027,
      configLocation: "scripts/import/sheets/scene2027.ts",
    },
    review,
  );
}
