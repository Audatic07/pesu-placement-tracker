/**
 * Statistical primitives.
 *
 * Separated from the queries and given their own tests because the source
 * spreadsheet demonstrates how easily these rot: its Tier 2 tab records
 *
 *     Wt. Average CTC | "TBD Error with formula"
 *
 * with the broken formula pasted in beside it as a comment, and its Tier 1
 * average silently excludes companies by VALUE rather than by row.
 *
 * Weighted figures matter more than plain ones here. Fifteen companies at 6 LPA
 * hiring one student each and one company at 6 LPA hiring eighty describe very
 * different batches, and only the headcount-weighted figures tell them apart.
 */

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? null);
}

/** Linear-interpolation percentile, matching the usual spreadsheet definition. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0] ?? null;

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) return sorted[lower] ?? null;
  const weight = position - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}

export function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values);
  if (average === null) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/*
 * Headcount weighting used to live here: a weighted mean and median that let a
 * spreadsheet row saying "this company hired eighty people" count eighty times
 * against a student submission counting once. Both were removed along with the
 * merge they served. Every row a statistic sees is now one person, so a weight
 * would always be 1 and a weighted median is just a median.
 */

/** Least-squares fit, for the "does CGPA actually matter" scatter. */
export type LinearFit = {
  slope: number;
  intercept: number;
  /** Coefficient of determination: how much of the variation the line explains. */
  rSquared: number;
  n: number;
};

export function linearRegression(points: Array<{ x: number; y: number }>): LinearFit | null {
  const usable = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  if (usable.length < 3) return null;

  const n = usable.length;
  const meanX = usable.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = usable.reduce((sum, p) => sum + p.y, 0) / n;

  let covariance = 0;
  let varianceX = 0;
  for (const point of usable) {
    covariance += (point.x - meanX) * (point.y - meanY);
    varianceX += (point.x - meanX) ** 2;
  }

  if (varianceX === 0) return null;

  const slope = covariance / varianceX;
  const intercept = meanY - slope * meanX;

  let residual = 0;
  let total = 0;
  for (const point of usable) {
    residual += (point.y - (slope * point.x + intercept)) ** 2;
    total += (point.y - meanY) ** 2;
  }

  return {
    slope,
    intercept,
    rSquared: total === 0 ? 0 : 1 - residual / total,
    n,
  };
}

/** Histogram with fixed-width buckets, for package distribution charts. */
export type Bucket = { lower: number; upper: number; count: number };

export function histogram(values: number[], bucketWidth: number): Bucket[] {
  if (values.length === 0 || bucketWidth <= 0) return [];

  const max = Math.max(...values);
  const bucketCount = Math.max(1, Math.ceil((max + 0.000_001) / bucketWidth));
  const buckets: Bucket[] = Array.from({ length: bucketCount }, (_unused, index) => ({
    lower: index * bucketWidth,
    upper: (index + 1) * bucketWidth,
    count: 0,
  }));

  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) continue;
    const index = Math.min(buckets.length - 1, Math.floor(value / bucketWidth));
    const bucket = buckets[index];
    if (bucket) bucket.count += 1;
  }

  return buckets;
}
