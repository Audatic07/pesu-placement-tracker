/**
 * Parsing the dates in the placement sheets.
 *
 * Five incompatible things live in these columns:
 *
 *   "04/08/25"                          DD/MM/YY
 *   "20/09/2025"                        DD/MM/YYYY
 *   "29/10/25 - 30/10/25"               a range
 *   "13-14/11/25", "26-28/11/25"        a range inside one month
 *   "No OA", "TBD", "Yet to come"       not a date at all
 *   "1st round - 07/10/2025 ⏎ 2nd..."   several dates in prose
 *   Date(2025-03-11T00:00:00Z)          a spreadsheet-mangled date
 *
 * The last one is the interesting case. Google Sheets parsed some DD/MM
 * entries as MM/DD, so a cell whose text was "03/11/25" (3 November) is now
 * stored as 11 March. The day and month are swapped, and only for entries
 * where the day was 12 or lower — anything higher could not be read as a month
 * and survived intact.
 *
 * We cannot tell "swapped" from "correct" by looking at the value alone when
 * both components are 12 or lower. So we use the season window: a placement
 * season runs roughly August to June, and a date outside it is wrong. When
 * exactly one reading falls inside the window, take it. When both do, the cell
 * is genuinely ambiguous and gets flagged for a human rather than guessed at.
 */

export type ParsedDate = {
  start: Date | null;
  end: Date | null;
  /** The original cell content, always preserved. */
  raw: string;
  /** True when the value is text that is not a date ("No OA", "TBD"). */
  isNonDate: boolean;
  /** True when we could not choose between two readings. Goes to review. */
  isAmbiguous: boolean;
  /** Why this needed a judgement call, for the review log. */
  note?: string;
};

export type SeasonWindow = {
  start: Date;
  end: Date;
};

const NON_DATE_MARKERS = [
  "no oa",
  "tbd",
  "n/a",
  "na",
  "none",
  "yet to",
  "not yet",
  "-",
  "--",
];

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function inWindow(date: Date, window: SeasonWindow): boolean {
  return date >= window.start && date <= window.end;
}

function expandYear(raw: number): number {
  if (raw >= 1000) return raw;
  // Two-digit years: 00-79 -> 2000s, 80-99 -> 1900s. Same convention as
  // lib/auth/srn.ts, stated rather than implied.
  return raw <= 79 ? 2000 + raw : 1900 + raw;
}

function isValid(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = utc(year, month, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Resolves a Date object that the spreadsheet may have day/month swapped.
 * Returns the corrected date plus whether the choice was forced or ambiguous.
 */
function resolveSwappedDate(
  value: Date,
  window: SeasonWindow,
): { date: Date; ambiguous: boolean; note?: string } {
  const year = value.getUTCFullYear();
  const storedMonth = value.getUTCMonth() + 1;
  const storedDay = value.getUTCDate();

  const asStored = utc(year, storedMonth, storedDay);

  // A stored day above 12 could never have been a month, so no swap happened.
  if (storedDay > 12) {
    return { date: asStored, ambiguous: false };
  }

  const swapped = isValid(year, storedDay, storedMonth)
    ? utc(year, storedDay, storedMonth)
    : null;

  if (!swapped || swapped.getTime() === asStored.getTime()) {
    return { date: asStored, ambiguous: false };
  }

  const storedInWindow = inWindow(asStored, window);
  const swappedInWindow = inWindow(swapped, window);

  if (swappedInWindow && !storedInWindow) {
    return {
      date: swapped,
      ambiguous: false,
      note: `Spreadsheet stored ${asStored.toISOString().slice(0, 10)}, which falls outside the season; read as ${swapped.toISOString().slice(0, 10)} (day/month swapped).`,
    };
  }

  if (storedInWindow && !swappedInWindow) {
    return { date: asStored, ambiguous: false };
  }

  if (!storedInWindow && !swappedInWindow) {
    return {
      date: asStored,
      ambiguous: true,
      note: `Neither ${asStored.toISOString().slice(0, 10)} nor ${swapped.toISOString().slice(0, 10)} falls inside the season window.`,
    };
  }

  // Both readings are plausible. Do not guess.
  return {
    date: asStored,
    ambiguous: true,
    note: `Ambiguous: could be ${asStored.toISOString().slice(0, 10)} or ${swapped.toISOString().slice(0, 10)}; both fall inside the season.`,
  };
}

/** "13-14/11/25" and "26-28/11/25" — a day range inside one month. */
const SAME_MONTH_RANGE = /^(\d{1,2})\s*[-–]\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/;

/** "29/10/25 - 30/10/25" — two full dates. */
const FULL_RANGE =
  /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})\s*[-–]\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/;

/** A single DD/MM/YY or DD/MM/YYYY anywhere in the text. */
const SINGLE_DATE = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/;

export function parseSheetDate(
  value: unknown,
  window: SeasonWindow,
): ParsedDate {
  if (value === null || value === undefined) {
    return { start: null, end: null, raw: "", isNonDate: false, isAmbiguous: false };
  }

  if (value instanceof Date) {
    const raw = value.toISOString();
    const resolved = resolveSwappedDate(value, window);
    return {
      start: resolved.date,
      end: null,
      raw,
      isNonDate: false,
      isAmbiguous: resolved.ambiguous,
      note: resolved.note,
    };
  }

  const raw = String(value).replace(/\s+/g, " ").trim();
  if (!raw) {
    return { start: null, end: null, raw: "", isNonDate: false, isAmbiguous: false };
  }

  const lowered = raw.toLowerCase();
  if (NON_DATE_MARKERS.some((marker) => lowered === marker || lowered.startsWith(`${marker} `))) {
    return { start: null, end: null, raw, isNonDate: true, isAmbiguous: false };
  }

  const fullRange = FULL_RANGE.exec(raw);
  if (fullRange) {
    const [, d1, m1, y1, d2, m2, y2] = fullRange;
    const startYear = expandYear(Number(y1));
    const endYear = expandYear(Number(y2));
    if (isValid(startYear, Number(m1), Number(d1)) && isValid(endYear, Number(m2), Number(d2))) {
      return {
        start: utc(startYear, Number(m1), Number(d1)),
        end: utc(endYear, Number(m2), Number(d2)),
        raw,
        isNonDate: false,
        isAmbiguous: false,
      };
    }
  }

  const sameMonth = SAME_MONTH_RANGE.exec(raw);
  if (sameMonth) {
    const [, d1, d2, month, year] = sameMonth;
    const fullYear = expandYear(Number(year));
    if (isValid(fullYear, Number(month), Number(d1)) && isValid(fullYear, Number(month), Number(d2))) {
      return {
        start: utc(fullYear, Number(month), Number(d1)),
        end: utc(fullYear, Number(month), Number(d2)),
        raw,
        isNonDate: false,
        isAmbiguous: false,
      };
    }
  }

  const single = SINGLE_DATE.exec(raw);
  if (single) {
    const [, day, month, year] = single;
    const fullYear = expandYear(Number(year));
    if (isValid(fullYear, Number(month), Number(day))) {
      const date = utc(fullYear, Number(month), Number(day));
      // Prose containing several dates ("1st round - 07/10, 2nd round - 11/10"):
      // take the first, keep the rest in `raw`, and say so.
      const extraDates = raw.match(new RegExp(SINGLE_DATE, "g"))?.length ?? 1;
      return {
        start: date,
        end: null,
        raw,
        isNonDate: false,
        isAmbiguous: false,
        note:
          extraDates > 1
            ? `Cell contains ${extraDates} dates; imported the first. Full text preserved.`
            : undefined,
      };
    }
    return {
      start: null,
      end: null,
      raw,
      isNonDate: false,
      isAmbiguous: true,
      note: `Looks like a date but is not valid: "${raw}".`,
    };
  }

  // Free text that is not a date and not a recognised marker — e.g. "14-18",
  // a bare month, or a note that landed in a date column.
  return { start: null, end: null, raw, isNonDate: true, isAmbiguous: false };
}

/**
 * The season window for a graduating batch. Placement seasons open in August
 * of the preceding calendar year — the 2026 sheet records "The process started
 * on 01 Aug 2025" — and we allow through to August of the graduating year so
 * that late offers and PPO conversions are not rejected.
 */
export function seasonWindowForBatch(graduationYear: number): SeasonWindow {
  return {
    start: utc(graduationYear - 1, 8, 1),
    end: utc(graduationYear, 8, 31),
  };
}
