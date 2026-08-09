import { formatCount } from "@/components/ui/primitives";

/**
 * Charts, rendered server-side as inline SVG.
 *
 * These forms are simple enough that a charting library would add a client
 * bundle and a hydration step for nothing. Every mark carries a <title> as a
 * single interpolated string — React's comment separators between adjacent text
 * children are stripped by the SVG parser and break hydration.
 *
 * The colour ramp is validated with the dataviz validator against this app's
 * exact surfaces. Do not substitute values by eye.
 */

const ORDINAL = ["var(--viz-ordinal-1)", "var(--viz-ordinal-2)", "var(--viz-ordinal-3)"];

export type BarDatum = { label: string; value: number; detail?: string };

/** Ordered categories (tiers), so one hue stepped by magnitude rather than a
 *  categorical palette — rank is the information. */
export function TierBars({ data }: { data: BarDatum[] }) {
  const max = Math.max(...data.map((datum) => datum.value), 1);
  const total = data.reduce((sum, datum) => sum + datum.value, 0);

  return (
    <ul className="flex flex-col gap-3">
      {data.map((datum, index) => {
        const share = total === 0 ? 0 : Math.round((datum.value / total) * 100);
        return (
          <li key={datum.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-medium">{datum.label}</span>
              <span className="tnum text-[13px]">
                {formatCount(datum.value)}
                <span className="ml-1.5 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                  {share}%
                </span>
              </span>
            </div>
            <div
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: "var(--viz-track)" }}
              role="img"
              aria-label={`${datum.label}: ${datum.value} offers, ${share} per cent`}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${max === 0 ? 0 : (datum.value / max) * 100}%`,
                  background: ORDINAL[index] ?? ORDINAL[ORDINAL.length - 1],
                }}
              />
            </div>
            {datum.detail ? (
              <div className="mt-1 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                {datum.detail}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export type Bucket = { lower: number; upper: number; count: number };

export function Histogram({
  buckets,
  unit = "",
  height = 150,
}: {
  buckets: Bucket[];
  unit?: string;
  height?: number;
}) {
  if (buckets.length === 0 || buckets.every((bucket) => bucket.count === 0)) {
    return (
      <p className="py-8 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
        Nothing to plot for this selection.
      </p>
    );
  }

  const width = 640;
  const bottom = 22;
  const top = 12;
  const plot = height - bottom - top;
  const max = Math.max(...buckets.map((bucket) => bucket.count));
  const slot = width / buckets.length;
  const barWidth = Math.max(3, slot - 2);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={buckets
        .filter((bucket) => bucket.count > 0)
        .map((bucket) => `${bucket.lower}–${bucket.upper}${unit}: ${bucket.count}`)
        .join("; ")}
      style={{ maxWidth: "100%" }}
    >
      <line
        x1="0"
        x2={width}
        y1={height - bottom}
        y2={height - bottom}
        stroke="var(--viz-axis)"
        strokeWidth="1"
      />
      {buckets.map((bucket, index) => {
        const barHeight = max === 0 ? 0 : (bucket.count / max) * plot;
        const x = index * slot + 1;
        const y = height - bottom - barHeight;
        return (
          <g key={`${bucket.lower}`}>
            <title>
              {`${bucket.lower}–${bucket.upper}${unit}: ${bucket.count} package${bucket.count === 1 ? "" : "s"}`}
            </title>
            {bucket.count > 0 ? (
              <rect x={x} y={y} width={barWidth} height={barHeight} rx="3" fill="var(--viz-1)" />
            ) : null}
            {bucket.count === max && bucket.count > 0 ? (
              <text
                x={x + barWidth / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize="10"
                fill="var(--text-tertiary)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {bucket.count}
              </text>
            ) : null}
            {index % 4 === 0 || index === buckets.length - 1 ? (
              <text
                x={x + barWidth / 2}
                y={height - bottom + 14}
                textAnchor="middle"
                fontSize="10"
                fill="var(--text-tertiary)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {bucket.lower}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
