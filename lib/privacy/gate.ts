/**
 * The privacy gate.
 *
 * A "hide my name" checkbox does not make a record anonymous. If a student
 * filters to branch = EEE, company = Netradyne, and one offer comes back, they
 * have learned that person's CGPA and package regardless of whose name is on
 * it — everyone in EEE knows who got the Netradyne offer.
 *
 * So no aggregate over a cohort smaller than K is ever returned. Minimum and
 * maximum are suppressed with the rest: they leak hardest, because a maximum
 * IS one person's exact package.
 *
 * Statistics are produced ONLY through this module. The type system enforces
 * it — `Suppressible<T>` cannot be read without handling the suppressed case,
 * so a caller cannot forget.
 */

export const DEFAULT_MIN_COHORT_SIZE = 5;

export function minCohortSize(): number {
  const configured = Number.parseInt(process.env.PRIVACY_MIN_COHORT_SIZE ?? "", 10);
  return Number.isFinite(configured) && configured >= 2 ? configured : DEFAULT_MIN_COHORT_SIZE;
}

export type Suppressed = {
  suppressed: true;
  /** How many records were in the cohort. Safe to reveal: it is not a value. */
  cohortSize: number;
  minimumRequired: number;
  reason: string;
};

export type Revealed<T> = {
  suppressed: false;
  value: T;
  cohortSize: number;
};

export type Suppressible<T> = Suppressed | Revealed<T>;

export function suppress(cohortSize: number, minimum = minCohortSize()): Suppressed {
  return {
    suppressed: true,
    cohortSize,
    minimumRequired: minimum,
    reason:
      cohortSize === 0
        ? "No records match this filter."
        : `Only ${cohortSize} record${cohortSize === 1 ? "" : "s"} match this filter. ` +
          `At least ${minimum} are needed before figures are shown, so that individual ` +
          `students cannot be identified from them.`,
  };
}

export function reveal<T>(value: T, cohortSize: number): Revealed<T> {
  return { suppressed: false, value, cohortSize };
}

/**
 * Wraps a computed statistic, returning it only if the cohort is large enough.
 * `compute` is not called when the cohort is too small, so an expensive
 * aggregate is not paid for just to be thrown away.
 */
export function gate<T>(
  cohortSize: number,
  compute: () => T,
  minimum = minCohortSize(),
): Suppressible<T> {
  if (cohortSize < minimum) return suppress(cohortSize, minimum);
  return reveal(compute(), cohortSize);
}

/** Reads a gated value, or a fallback. For rendering, never for further maths. */
export function valueOr<T, F>(gated: Suppressible<T>, fallback: F): T | F {
  return gated.suppressed ? fallback : gated.value;
}

/**
 * CGPA as a band, for public display.
 *
 * An exact CGPA is close to a fingerprint — combined with branch and company it
 * identifies a person even inside a large cohort. Bands of 0.25 keep the figure
 * useful for "what did people who got this offer look like" without that.
 */
export function cgpaBand(cgpa: number | null | undefined, width = 0.25): string | null {
  if (cgpa === null || cgpa === undefined || !Number.isFinite(cgpa)) return null;
  const clamped = Math.max(0, Math.min(10, cgpa));
  const lower = Math.floor(clamped / width) * width;
  const upper = Math.min(10, lower + width);
  return `${lower.toFixed(2)}–${upper.toFixed(2)}`;
}

/**
 * Whether a name may be shown.
 *
 * Requires an explicit opt-in AND a record that is not under dispute — an
 * offer someone has credibly reported should not carry a name while it is
 * being decided.
 */
export function canShowName(offer: {
  nameVisibility: string;
  verification: string;
  deletedAt: Date | null;
}): boolean {
  return (
    offer.nameVisibility === "NAMED" &&
    offer.verification !== "DISPUTED" &&
    offer.verification !== "REMOVED" &&
    offer.deletedAt === null
  );
}
