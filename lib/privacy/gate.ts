/** Placement figures are visible for every nonempty cohort; names stay private. */

export const DEFAULT_MIN_COHORT_SIZE = 1;

export function minCohortSize(): number {
  // The former environment setting must not keep old deployments suppressing
  // known values after the name-only anonymity policy was adopted.
  return DEFAULT_MIN_COHORT_SIZE;
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
          `At least ${minimum} are needed before figures are shown.`,
  };
}

export function reveal<T>(value: T, cohortSize: number): Revealed<T> {
  return { suppressed: false, value, cohortSize };
}

/**
 * Empty cohorts have no statistic. Every nonempty cohort is shown by default.
 * An explicit minimum remains available for calculations requiring a sample.
 */
export function gate<T>(
  cohortSize: number,
  compute: () => T,
  minimum = minCohortSize(),
): Suppressible<T> {
  if (cohortSize < minimum) return suppress(cohortSize, minimum);
  return reveal(compute(), cohortSize);
}

/**
 * CGPA as a band, for public display.
 *
 * Retained for aggregate chart grouping and compatibility with stored records.
 * Offer detail can show the exact reported figure under the current policy.
 */
export function cgpaBand(cgpa: number | null | undefined, width = 0.25): string | null {
  if (cgpa === null || cgpa === undefined || !Number.isFinite(cgpa)) return null;
  const clamped = Math.max(0, Math.min(10, cgpa));
  const lower = Math.floor(clamped / width) * width;
  const upper = Math.min(10, lower + width);
  return `${lower.toFixed(2)}–${upper.toFixed(2)}`;
}

/**
 * Recipient names are never displayed in placement views, including legacy
 * offers with the old NAMED flag. Account/administration identity is separate.
 */
export function canShowName(_offer: {
  nameVisibility: string;
  verification: string;
  deletedAt: Date | null;
}): boolean {
  return false;
}
