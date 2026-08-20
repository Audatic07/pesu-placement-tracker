import type { Workbook } from "exceljs";
import type { ReviewLog } from "../lib/review";
import type { ImportedWorkbook } from "./types";
import {
  readColourCodedWorkbook,
  type TabSpec,
} from "./scene2026";

/**
 * Reader for the 2027 placement workbook — the season being played right now.
 *
 * It is the same colour-coded format as 2026 (merged company blocks, round mode
 * in cell fill, OA / Interview / Presentation date columns), so it reuses that
 * reader; only the column layout differs. Two changes from 2026 are worth
 * naming:
 *
 *   - There is no eligible-branches column, and the compensation, placed and
 *     date columns all sit one or more columns to the left of where 2026 puts
 *     them. Each tab's TabSpec below pins the exact positions and the header row
 *     is verified before any value is read.
 *   - The footer is a single orange "Total" line rather than 2026's navy
 *     summary block, carrying only placed counts. There is nothing rich enough
 *     to verify the whole import against, so footers are not emitted (the
 *     shared reader's totals-row guard still stops before that line so it is not
 *     read as a company). Fidelity rests on the review log and a manual read.
 *
 * This replaces the earlier hand-entered 2027 stub: a real workbook exists now,
 * with tiers, so tiers come from the tabs rather than being derived from CTC.
 */

const TABS: TabSpec[] = [
  {
    sheet: "Tier 1",
    headerRow: 4,
    firstDataRow: 5,
    expectedHeaders: [
      [1, /^company$/i],
      [2, /^role$/i],
      [3, /internship/i],
      [4, /^base$/i],
      [5, /ctc/i],
      [6, /internship/i],
      [7, /^fte$/i],
      [8, /^both$/i],
      [10, /gpa/i],
      [11, /^note$/i],
      [12, /presentation/i],
      [13, /^oa date$/i],
      [14, /interview/i],
    ],
    layout: {
      company: 1,
      role: 2,
      eligibleBranches: null,
      stipend: 3,
      base: 4,
      ctc: 5,
      placedInternship: 6,
      placedFte: 7,
      placedBoth: 8,
      gpaCutoff: 10,
      note: 11,
      presentationDate: 12,
      oaDate: 13,
      interviewDate: 14,
    },
    tierKey: "TIER_1",
    cycle: "FULL_TIME",
  },
  {
    // Company sits in column 1 but the rest of the row is shifted three columns
    // right of Tier 1.
    sheet: "Tier 2",
    headerRow: 3,
    firstDataRow: 4,
    expectedHeaders: [
      [1, /^company$/i],
      [4, /^role$/i],
      [5, /internship/i],
      [6, /^base$/i],
      [7, /ctc/i],
      [8, /internship/i],
      [9, /^fte$/i],
      [10, /^both$/i],
      [11, /gpa/i],
      [12, /^note$/i],
      [13, /presentation/i],
      [14, /^oa date$/i],
      [15, /interview/i],
    ],
    layout: {
      company: 1,
      role: 4,
      eligibleBranches: null,
      stipend: 5,
      base: 6,
      ctc: 7,
      placedInternship: 8,
      placedFte: 9,
      placedBoth: 10,
      gpaCutoff: 11,
      note: 12,
      presentationDate: 13,
      oaDate: 14,
      interviewDate: 15,
    },
    tierKey: "TIER_2",
    cycle: "FULL_TIME",
  },
];

export function readScene2027(workbook: Workbook, review: ReviewLog): ImportedWorkbook {
  return readColourCodedWorkbook(
    workbook,
    { batchYear: 2027, tabs: TABS, emitFooters: false, deriveTierFromCtc: false },
    review,
  );
}
