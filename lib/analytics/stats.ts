export type PackageStats = {
  count: number;
  highest: number | null;
  average: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
  standardDeviation: number | null;
};

export function packageStats(values: number[]): PackageStats {
  return {
    count: values.length,
    highest: values.length ? Math.max(...values) : null,
    average: mean(values),
    median: median(values),
    p25: percentile(values, 0.25),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.9),
    standardDeviation: standardDeviation(values),
  };
}

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
  const usable = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (usable.length === 0 || !Number.isFinite(bucketWidth) || bucketWidth <= 0) return [];

  const max = Math.max(...usable);
  const bucketCount = Math.max(1, Math.ceil((max + 0.000_001) / bucketWidth));
  const buckets: Bucket[] = Array.from({ length: bucketCount }, (_unused, index) => ({
    lower: index * bucketWidth,
    upper: (index + 1) * bucketWidth,
    count: 0,
  }));

  for (const value of usable) {
    const index = Math.min(buckets.length - 1, Math.floor(value / bucketWidth));
    const bucket = buckets[index];
    if (bucket) bucket.count += 1;
  }

  return buckets;
}
