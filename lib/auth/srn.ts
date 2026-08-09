/**
 * Deriving a student's graduating batch.
 *
 * The SRN encodes the admission year, which is a far more stable signal than
 * the reported semester: semesters go stale between terms, get reported
 * inconsistently during the gap in July, and say nothing useful about a
 * student who has dropped a year.
 *
 *   PES1UG23CS001
 *   ^^^ ^ ^^ ^^ ^^^
 *    |  | |  |   +-- serial
 *    |  | |  +------ branch code
 *    |  | +--------- admission year (2-digit)
 *    |  +----------- UG / PG
 *    +-------------- institute + campus digit (1 = RR, 2 = EC)
 *
 * Pure functions, no database and no clock of their own — the caller passes
 * `now` so this is testable without freezing time.
 */

const SRN_PATTERN = /^PES(\d)(UG|PG)(\d{2})([A-Z]{2,4})(\d{2,4})$/i;

export type ParsedSrn = {
  campusCode: number;
  level: "UG" | "PG";
  admissionYear: number;
  branchCode: string;
  serial: string;
};

export function parseSrn(srn: string): ParsedSrn | null {
  const match = SRN_PATTERN.exec(srn.trim().replace(/\s+/g, ""));
  if (!match) return null;

  const [, campus, level, yy, branch, serial] = match;
  if (!campus || !level || !yy || !branch || !serial) return null;

  const twoDigit = Number.parseInt(yy, 10);
  if (!Number.isFinite(twoDigit)) return null;

  // Two-digit years are a time bomb, so resolve them explicitly rather than by
  // assuming a century: 00-79 -> 2000s, 80-99 -> 1900s. Good until 2080, and
  // the assumption is stated here rather than buried in an offset.
  const admissionYear = twoDigit <= 79 ? 2000 + twoDigit : 1900 + twoDigit;

  return {
    campusCode: Number.parseInt(campus, 10),
    level: level.toUpperCase() as "UG" | "PG",
    admissionYear,
    branchCode: branch.toUpperCase(),
    serial,
  };
}

/**
 * Graduating year from the admission year in the SRN. This is the primary
 * signal.
 */
export function graduationYearFromSrn(
  srn: string,
  programDurationYears: number,
): number | null {
  const parsed = parseSrn(srn);
  if (!parsed) return null;
  return parsed.admissionYear + programDurationYears;
}

/**
 * Fallback for when the SRN does not parse — a transfer student, a format
 * change, or an SRN we have not seen before.
 *
 * Derivation. An academic year starting in calendar year Y runs its odd
 * semester Aug-Dec Y and its even semester Jan-Jun Y+1. So:
 *
 *   odd  semester s: the final semester T lands in June of Y + 1 + floor((T-s-1)/2)
 *   even semester s: the final semester T lands in June of Y + 1 + ceil((T-s)/2)
 *
 * The odd case handles T === s correctly on its own — floor(-1/2) is -1 in
 * JavaScript, giving Y, which is the December of the current term.
 */
export function graduationYearFromSemester(
  semester: number,
  totalSemesters: number,
  now: Date,
): number | null {
  if (!Number.isFinite(semester) || semester < 1 || semester > totalSemesters) {
    return null;
  }

  const month = now.getUTCMonth() + 1; // 1-12
  const academicYearStart =
    month >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;

  const remaining = totalSemesters - semester;
  const isOdd = semester % 2 === 1;

  return isOdd
    ? academicYearStart + 1 + Math.floor((remaining - 1) / 2)
    : academicYearStart + 1 + Math.ceil(remaining / 2);
}

/** Parses PESU's semester string, which arrives as "5", "Sem 5", or "V". */
export function parseSemester(raw: string | null | undefined): number | null {
  if (!raw) return null;

  const digits = /(\d+)/.exec(raw);
  if (digits?.[1]) {
    const value = Number.parseInt(digits[1], 10);
    return Number.isFinite(value) && value >= 1 && value <= 12 ? value : null;
  }

  const roman: Record<string, number> = {
    I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6,
    VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
  };
  const key = raw.trim().toUpperCase().replace(/^SEM(ESTER)?\s*/, "");
  return roman[key] ?? null;
}
