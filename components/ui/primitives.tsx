import type { ReactNode } from "react";
import Link from "next/link";

/**
 * The component vocabulary.
 *
 * Everything here is deliberately small and unstyled-by-default: dense rows,
 * hairline separation, one accent, status carried by a dot plus a word rather
 * than by colour alone. Nothing is a card unless it genuinely groups something.
 */

/* ---------------------------------------------------------------- formatting */

export function formatLpa(value: number | null | undefined, withUnit = true): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${value.toFixed(digits)}${withUnit ? " LPA" : ""}`;
}

export function formatInr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

export function formatCompactInr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(value % 100_000 === 0 ? 0 : 1)}L`;
  if (value >= 1000) return `₹${Math.round(value / 1000)}k`;
  return `₹${Math.round(value)}`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN");
}

export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

/* -------------------------------------------------------------------- layout */

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="border-b px-6 py-5" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-[68ch] text-[13px]" style={{ color: "var(--text-secondary)" }}>
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {meta ? <div className="mt-4">{meta}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  padded = true,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section
      className="overflow-hidden rounded-[var(--radius-panel)] border"
      style={{ borderColor: "var(--line)", background: "var(--panel)" }}
    >
      {title ? (
        <header
          className="flex items-center justify-between gap-4 border-b px-4 py-3"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="min-w-0">
            <h2 className="text-[13px] font-medium">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      ) : null}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

/* --------------------------------------------------------------------- stats */

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border sm:grid-cols-3 lg:grid-cols-5"
      style={{ borderColor: "var(--line)", background: "var(--line)" }}
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "critical" | "warning";
}) {
  const color =
    tone === "good"
      ? "var(--good)"
      : tone === "critical"
        ? "var(--critical)"
        : tone === "warning"
          ? "var(--warning)"
          : "var(--text)";

  return (
    <div className="px-4 py-3.5" style={{ background: "var(--panel)" }}>
      <div className="text-[11px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--text-tertiary)" }}>
        {label}
      </div>
      <div className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight" style={{ color }}>
        {value}
      </div>
      {hint ? (
        <div className="mt-1.5 text-[12px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- badges */

export type Tone = "neutral" | "good" | "warning" | "critical" | "accent";

const TONE_COLOR: Record<Tone, string> = {
  neutral: "var(--neutral-dot)",
  good: "var(--good)",
  warning: "var(--warning)",
  critical: "var(--critical)",
  accent: "var(--accent)",
};

/** Status is a dot plus a word — never colour on its own. */
export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]">
      <span
        aria-hidden
        className="size-[6px] shrink-0 rounded-full"
        style={{ background: TONE_COLOR[tone] }}
      />
      <span style={{ color: "var(--text-secondary)" }}>{children}</span>
    </span>
  );
}

export function Tag({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ background: "var(--viz-track)", color: "var(--text-secondary)" }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- buttons */

export function Button({
  children,
  href,
  variant = "secondary",
  size = "md",
  type,
  disabled,
  ...rest
}: {
  children: ReactNode;
  href?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  type?: "button" | "submit";
  disabled?: boolean;
} & Record<string, unknown>) {
  const base =
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const sizing = size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]";

  const style =
    variant === "primary"
      ? { background: "var(--accent-solid)", color: "var(--accent-fg)" }
      : variant === "ghost"
        ? { color: "var(--text-secondary)" }
        : {
            background: "var(--panel)",
            color: "var(--text)",
            boxShadow: "inset 0 0 0 1px var(--line-strong)",
          };

  if (href) {
    return (
      <Link href={href} className={`${base} ${sizing}`} style={style} {...rest}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type ?? "button"} disabled={disabled} className={`${base} ${sizing}`} style={style} {...rest}>
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------- states */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <p className="text-[13px] font-medium">{title}</p>
      {description ? (
        <p className="mt-1 max-w-[46ch] text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * A statistic withheld by the privacy floor. Rendered as an explanation rather
 * than a blank, because "we are not showing you this, and here is why" is
 * information and an empty cell is not.
 */
export function Withheld({ reason }: { reason: string }) {
  return (
    <div
      className="rounded-[var(--radius-control)] border border-dashed px-4 py-6 text-[13px] leading-relaxed"
      style={{ borderColor: "var(--line-strong)", color: "var(--text-tertiary)" }}
    >
      {reason}
    </div>
  );
}

/** Attribution for where a figure came from. Never decorative. */
export function SourceNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 text-[12px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
      {children}
    </p>
  );
}
