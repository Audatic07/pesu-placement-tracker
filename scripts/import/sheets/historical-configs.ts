import type { Workbook } from "exceljs";
import type { ReviewLog } from "../lib/review";
import type { ImportedWorkbook } from "./types";
import {
  readHistoricalWorkbook,
  type HistoricalColumns,
  type HistoricalConfig,
  type HistoricalTab,
} from "./historical";

/**
 * The per-workbook column maps for the 2022–2025 seasons.
 *
 * Each season's spreadsheet is laid out slightly differently — the header sits
 * on a different row, some tabs have a CGPA column and some do not, the older
 * ones split the interview schedule into PPT / Test / Interview columns — so
 * every tab states its own layout. The reader in historical.ts verifies the
 * header row against these before reading, so a drifted column fails loudly.
 *
 * A column set to null means the tab does not have it.
 */

const NONE: HistoricalColumns = {
  id: 1,
  company: 2,
  role: 3,
  stipend: null,
  base: null,
  ctc: null,
  placedFte: null,
  placedBoth: null,
  placedInternship: null,
  pptDate: null,
  testDate: null,
  interviewDate: null,
  gpaCutoff: null,
  note: null,
};

// ---------------------------------------------------------------------------
// 2025 — header on rows 1–2, data from row 3. Tier tabs split placed into
// FTE Only / FTE + Intern / Intern (PBC); no interview-schedule columns beyond
// a single "Date of Visit". No remarks column.
// ---------------------------------------------------------------------------
const TIER_HEADERS_2025: HistoricalTab["expectedHeaders"] = [
  [2, /company/i],
  [3, /job role/i],
  [4, /internship/i],
  [5, /base/i],
  [6, /ctc/i],
  [7, /fte only/i],
  [8, /fte \+ intern/i],
  [9, /intern/i],
  [10, /cgpa/i],
];

function tier2025(sheet: string, tierKey: string, withVisit: boolean): HistoricalTab {
  return {
    sheet,
    headerRow: 2,
    firstDataRow: 3,
    expectedHeaders: TIER_HEADERS_2025,
    columns: {
      ...NONE,
      stipend: 4,
      base: 5,
      ctc: 6,
      placedFte: 7,
      placedBoth: 8,
      placedInternship: 9,
      gpaCutoff: 10,
      pptDate: withVisit ? 11 : null,
    },
    tierKey,
    cycle: "FULL_TIME",
  };
}

const CONFIG_2025: HistoricalConfig = {
  batchYear: 2025,
  tabs: [
    tier2025("Tier 1", "TIER_1", true),
    tier2025("Tier 2", "TIER_2", false),
    tier2025("Tier 3", "TIER_3", false),
    {
      sheet: "Spring Internship",
      headerRow: 2,
      firstDataRow: 3,
      expectedHeaders: [
        [2, /company/i],
        [3, /job role/i],
        [4, /internship/i],
        [5, /base/i],
        [6, /ctc/i],
        [7, /intern/i],
        [8, /cgpa/i],
      ],
      columns: { ...NONE, stipend: 4, base: 5, ctc: 6, placedInternship: 7, gpaCutoff: 8, pptDate: 9 },
      tierKey: null,
      cycle: "SIX_MONTH_INTERNSHIP",
    },
    {
      sheet: "Summer Internship",
      headerRow: 2,
      firstDataRow: 3,
      expectedHeaders: [
        [2, /company/i],
        [3, /job role/i],
        [4, /internship/i],
        [5, /base/i],
        [6, /ctc/i],
        [7, /intern/i],
        [8, /cgpa/i],
      ],
      columns: { ...NONE, stipend: 4, base: 5, ctc: 6, placedInternship: 7, gpaCutoff: 8 },
      tierKey: null,
      cycle: "SUMMER_INTERNSHIP",
    },
  ],
};

// ---------------------------------------------------------------------------
// 2024 — header on rows 1–2, data from row 3. Two layouts: the "rich" tabs
// (Dream, Tier 1, Spring) split placed into FTE / Intern; the "lean" tabs
// (Tier 2, Tier 3, PPO) carry a single Selected/Jobs-Offered count. Remarks
// sit in the last column. Stray summary cells to the right (cols 11+) are never
// read because every column is addressed by index.
// ---------------------------------------------------------------------------
const HEADERS_2024: HistoricalTab["expectedHeaders"] = [
  [2, /company/i],
  [3, /job title/i],
  [4, /internship/i],
  [5, /base/i],
  [6, /ctc/i],
];

function richTab2024(sheet: string, tierKey: string | null, cycle: HistoricalTab["cycle"]): HistoricalTab {
  return {
    sheet,
    headerRow: 2,
    firstDataRow: 3,
    expectedHeaders: HEADERS_2024,
    columns: { ...NONE, stipend: 4, base: 5, ctc: 6, placedFte: 7, placedInternship: 8, gpaCutoff: 9, note: 10 },
    tierKey,
    cycle,
  };
}

const CONFIG_2024: HistoricalConfig = {
  batchYear: 2024,
  tabs: [
    {
      // Summer internships that converted to PPOs — one "Selected" count that
      // represents students holding both an internship and its FTE offer.
      sheet: "Summer Internships(PPO)",
      headerRow: 2,
      firstDataRow: 3,
      expectedHeaders: HEADERS_2024,
      columns: { ...NONE, stipend: 4, base: 5, ctc: 6, placedBoth: 7, gpaCutoff: 8, note: 9 },
      tierKey: null,
      cycle: "SUMMER_INTERNSHIP",
    },
    richTab2024("Dream Tier", "TIER_1", "FULL_TIME"),
    richTab2024("Tier 1", "TIER_1", "FULL_TIME"),
    {
      sheet: "Tier 2",
      headerRow: 2,
      firstDataRow: 3,
      expectedHeaders: HEADERS_2024,
      columns: { ...NONE, stipend: 4, base: 5, ctc: 6, placedFte: 7, gpaCutoff: 8, note: 9 },
      tierKey: "TIER_2",
      cycle: "FULL_TIME",
    },
    {
      sheet: "Tier 3",
      headerRow: 2,
      firstDataRow: 3,
      expectedHeaders: HEADERS_2024,
      columns: { ...NONE, stipend: 4, base: 5, ctc: 6, placedFte: 7, gpaCutoff: 8, note: 9 },
      tierKey: "TIER_3",
      cycle: "FULL_TIME",
    },
    richTab2024("Spring Internships", null, "SIX_MONTH_INTERNSHIP"),
  ],
};

// ---------------------------------------------------------------------------
// 2023 — a "TIER 1" banner on row 1, a two-row header on rows 2–3, data from
// row 4. Placed splits three ways and the interview schedule is spread across
// PPT / Test Date / Interview columns. Dream has no CGPA column.
// ---------------------------------------------------------------------------
const HEADERS_2023: HistoricalTab["expectedHeaders"] = [
  [2, /company/i],
  [3, /job title/i],
  [4, /internship/i],
  [5, /base/i],
  [6, /ctc/i],
];

function tierTab2023(sheet: string, tierKey: string, hasGpa: boolean): HistoricalTab {
  return {
    sheet,
    headerRow: 3,
    firstDataRow: 4,
    expectedHeaders: HEADERS_2023,
    columns: {
      ...NONE,
      stipend: 4,
      base: 5,
      ctc: 6,
      placedFte: 7,
      placedBoth: 8,
      placedInternship: 9,
      pptDate: 10,
      testDate: 11,
      interviewDate: 12,
      gpaCutoff: hasGpa ? 13 : null,
      note: hasGpa ? 14 : 13,
    },
    tierKey,
    cycle: "FULL_TIME",
  };
}

const CONFIG_2023: HistoricalConfig = {
  batchYear: 2023,
  tabs: [
    tierTab2023("Dream Tier", "TIER_1", false),
    tierTab2023("Tier 1", "TIER_1", true),
    tierTab2023("Tier 2", "TIER_2", true),
    tierTab2023("Tier 3", "TIER_3", true),
    {
      sheet: "Spring Internships",
      headerRow: 3,
      firstDataRow: 4,
      expectedHeaders: HEADERS_2023,
      columns: {
        ...NONE,
        stipend: 4,
        base: 5,
        ctc: 6,
        placedInternship: 7,
        pptDate: 8,
        testDate: 9,
        interviewDate: 10,
        gpaCutoff: 11,
      },
      tierKey: null,
      cycle: "SIX_MONTH_INTERNSHIP",
    },
  ],
};

// ---------------------------------------------------------------------------
// 2022 — a blank row 1, a banner on row 2, a two-row header on rows 3–4, data
// from row 5. No CGPA column on the tier tabs. The internship tabs relabel the
// columns (Stipend / Interns / … / Base(PPO) / CTC(PPO)).
// ---------------------------------------------------------------------------
const TIER_HEADERS_2022: HistoricalTab["expectedHeaders"] = [
  [2, /name/i],
  [3, /job title/i],
  [4, /stipend/i],
  [5, /base/i],
  [6, /ctc/i],
  [7, /fte/i],
  [8, /fte.*intern/i],
  [9, /intern/i],
];

function tierTab2022(sheet: string, tierKey: string): HistoricalTab {
  return {
    sheet,
    headerRow: 4,
    firstDataRow: 5,
    expectedHeaders: TIER_HEADERS_2022,
    columns: {
      ...NONE,
      stipend: 4,
      base: 5,
      ctc: 6,
      placedFte: 7,
      placedBoth: 8,
      placedInternship: 9,
      pptDate: 10,
      testDate: 11,
      interviewDate: 12,
      note: 13,
    },
    tierKey,
    cycle: "FULL_TIME",
  };
}

const CONFIG_2022: HistoricalConfig = {
  batchYear: 2022,
  tabs: [
    tierTab2022("Dream", "TIER_1"),
    tierTab2022("Tier-1", "TIER_1"),
    tierTab2022("Tier-2", "TIER_2"),
    tierTab2022("Tier-3", "TIER_3"),
    {
      // Spring internships: PPO base/CTC live in their own columns; the placed
      // count is the "Interns" column.
      sheet: "Spring Internship(2022)",
      headerRow: 4,
      firstDataRow: 5,
      expectedHeaders: [
        [2, /name/i],
        [3, /job title/i],
        [4, /stipend/i],
        [5, /interns/i],
        [9, /base/i],
        [10, /ctc/i],
      ],
      columns: {
        ...NONE,
        stipend: 4,
        placedInternship: 5,
        pptDate: 6,
        testDate: 7,
        interviewDate: 8,
        base: 9,
        ctc: 10,
        note: 11,
      },
      tierKey: null,
      cycle: "SIX_MONTH_INTERNSHIP",
    },
    {
      // The oldest tab: a single header row, no PPO salary, no remarks.
      sheet: "Summer Internship(2021)",
      headerRow: 3,
      firstDataRow: 4,
      expectedHeaders: [
        [2, /name/i],
        [3, /job title/i],
        [4, /stipend/i],
        [5, /interns/i],
        [6, /ppt/i],
        [7, /test date/i],
        [8, /interview/i],
      ],
      columns: { ...NONE, stipend: 4, placedInternship: 5, pptDate: 6, testDate: 7, interviewDate: 8 },
      tierKey: null,
      cycle: "SUMMER_INTERNSHIP",
    },
  ],
};

export function readScene2025(workbook: Workbook, review: ReviewLog): ImportedWorkbook {
  return readHistoricalWorkbook(workbook, CONFIG_2025, review);
}
export function readScene2024(workbook: Workbook, review: ReviewLog): ImportedWorkbook {
  return readHistoricalWorkbook(workbook, CONFIG_2024, review);
}
export function readScene2023(workbook: Workbook, review: ReviewLog): ImportedWorkbook {
  return readHistoricalWorkbook(workbook, CONFIG_2023, review);
}
export function readScene2022(workbook: Workbook, review: ReviewLog): ImportedWorkbook {
  return readHistoricalWorkbook(workbook, CONFIG_2022, review);
}
