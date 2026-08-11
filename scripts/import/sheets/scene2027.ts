import type { OfferCycle } from "@/generated/prisma/enums";
import { parseGpaCutoff } from "../lib/gpa";
import type {
  ImportedDrive,
  ImportedRole,
  ImportedRound,
  ImportedWorkbook,
} from "./types";

/**
 * The 2027 season, entered by hand rather than read from a spreadsheet.
 *
 * Unlike 2022–2026 there is no finished workbook for 2027 — the season is being
 * played right now (drives in July–August 2026). What we have is a short list of
 * companies that have visited so far, with the package they advertised and their
 * assessment / interview dates. This builds the same ImportedWorkbook the sheet
 * readers produce so the loader treats it identically.
 *
 * Two things are deliberately different from the historical import:
 *
 *   - No placement headcounts. These drives are ongoing; nobody has confirmed a
 *     final count, so placedInternship/Fte/Both are all null. The offer's nature
 *     is stated in the note instead ("Internship + FTE" / "FTE Only" /
 *     "Internship Only") and refineNatureFromNote resolves it — we do not invent
 *     student counts to imply a nature.
 *   - deriveTierFromCtc is true: there are no tier tabs here, one flat list, so a
 *     role's tier is worked out from its CTC by the loader.
 */

const BATCH_YEAR = 2027;
const SHEET = "2027 Batch";

type Nature = "INTERN_FTE" | "FTE" | "INTERN";

type Entry = {
  company: string;
  stipendPerMonthInr: number | null;
  ctcLpa: number | null;
  nature: Nature;
  /** [day, month] in 2026 for the online assessment, if one has happened. */
  oa?: [number, number];
  /** [day, month] in 2026 for the interview, if one is scheduled. */
  interview?: [number, number];
};

/**
 * Companies as reported for the 2027 batch. Names are the canonical spellings
 * from KNOWN_GROUPS where one exists (Eternal (Zomato), Netcore Cloud,
 * TheMathCompany, inMobi, Arctic Wolf, Sixt, Vyapar, 4Good.AI, IBM (ISDL)); the
 * rest — Lam Research, Cloudera, SolarWinds, Couchbase — are created fresh.
 */
const ENTRIES: Entry[] = [
  { company: "Eternal (Zomato)", stipendPerMonthInr: 100_000, ctcLpa: 59, nature: "INTERN_FTE", oa: [28, 7], interview: [3, 8] },
  { company: "Netcore Cloud", stipendPerMonthInr: 30_000, ctcLpa: 29.5, nature: "INTERN_FTE", oa: [31, 7], interview: [4, 8] },
  { company: "TheMathCompany", stipendPerMonthInr: null, ctcLpa: 6, nature: "FTE", oa: [10, 8] },
  { company: "Lam Research", stipendPerMonthInr: 52_000, ctcLpa: 22.17838, nature: "INTERN_FTE", oa: [6, 8], interview: [10, 8] },
  { company: "inMobi", stipendPerMonthInr: 70_000, ctcLpa: 54, nature: "INTERN_FTE", oa: [7, 8], interview: [8, 8] },
  { company: "Arctic Wolf", stipendPerMonthInr: 60_000, ctcLpa: null, nature: "INTERN" },
  { company: "Cloudera", stipendPerMonthInr: 45_000, ctcLpa: 23, nature: "INTERN_FTE", oa: [10, 8] },
  { company: "Sixt", stipendPerMonthInr: 60_000, ctcLpa: 22.3, nature: "INTERN_FTE" },
  { company: "Vyapar", stipendPerMonthInr: 40_000, ctcLpa: 24, nature: "INTERN_FTE" },
  { company: "4Good.AI", stipendPerMonthInr: 20_000, ctcLpa: null, nature: "INTERN" },
  { company: "IBM (ISDL)", stipendPerMonthInr: 30_000, ctcLpa: 17, nature: "INTERN_FTE" },
  { company: "SolarWinds", stipendPerMonthInr: 45_000, ctcLpa: 20, nature: "INTERN_FTE" },
  { company: "Couchbase", stipendPerMonthInr: 125_000, ctcLpa: 26.11466, nature: "INTERN_FTE" },
];

/** The note text that carries the offer nature through refineNatureFromNote. */
const NATURE_NOTE: Record<Nature, string> = {
  INTERN_FTE: "Internship + FTE",
  FTE: "FTE Only",
  INTERN: "Internship Only",
};

/** Intern-only drives are the final-semester internship; the rest are full-time
 * placement drives (their internship is captured by the nature, not the cycle). */
const NATURE_CYCLE: Record<Nature, OfferCycle> = {
  INTERN_FTE: "FULL_TIME",
  FTE: "FULL_TIME",
  INTERN: "SIX_MONTH_INTERNSHIP",
};

function day(dayOfMonth: number, month: number): Date {
  return new Date(Date.UTC(2026, month - 1, dayOfMonth));
}

function buildRounds(entry: Entry): ImportedRound[] {
  const rounds: ImportedRound[] = [];
  let sequence = 1;

  if (entry.oa) {
    rounds.push({
      kind: "ONLINE_ASSESSMENT",
      mode: "UNKNOWN",
      sequence: sequence++,
      heldOn: day(entry.oa[0], entry.oa[1]),
      heldUntil: null,
      rawSchedule: null,
    });
  }
  if (entry.interview) {
    rounds.push({
      kind: "TECHNICAL_INTERVIEW",
      mode: "UNKNOWN",
      sequence: sequence++,
      heldOn: day(entry.interview[0], entry.interview[1]),
      heldUntil: null,
      rawSchedule: null,
    });
  }

  return rounds;
}

function buildDrive(entry: Entry, index: number): ImportedDrive {
  const note = NATURE_NOTE[entry.nature];

  const role: ImportedRole = {
    title: null,
    stipendPerMonthInr: entry.stipendPerMonthInr,
    baseLpa: null,
    ctcLpa: entry.ctcLpa,
    sharesCompensationWithPrevious: false,
    disclosure: "PARTIAL",
    compensationNote: null,
    components: [],
    placedInternship: null,
    placedFte: null,
    placedBoth: null,
    locations: [],
    bondMonths: null,
    internshipDurationMonths: null,
    note,
    rounds: buildRounds(entry),
    sheetRow: index + 1,
  };

  return {
    companyName: entry.company,
    inlineNote: null,
    tierKey: null,
    cycle: NATURE_CYCLE[entry.nature],
    eligibleBranches: [],
    gpaCutoff: parseGpaCutoff(null),
    flags: {
      isRepeatCompany: false,
      hiredTenPlus: false,
      massHired: false,
      hiredNobody: false,
      ditched: false,
      isFooter: false,
    },
    pptDate: null,
    note,
    roles: [role],
    sheet: SHEET,
    sheetRow: index + 1,
  };
}

export function buildScene2027(): ImportedWorkbook {
  return {
    batchYear: BATCH_YEAR,
    drives: ENTRIES.map(buildDrive),
    footers: [],
    deriveTierFromCtc: true,
  };
}
