"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  FileText,
  LayoutDashboard,
  Menu,
  Plus,
  ShieldAlert,
  User,
  X,
} from "lucide-react";

/**
 * The persistent sidebar.
 *
 * It carries the batch selector, because batch is the one dimension that scopes
 * every screen — putting it in the shell means a student picks a year once and
 * keeps it while moving around, instead of re-choosing on each page. It rides
 * in the query string rather than the path so that a link someone shares keeps
 * the whole view, filters included.
 */

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Match nested routes too, e.g. /companies/meesho. */
  prefix?: boolean;
};

const PRIMARY: NavItem[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/companies", label: "Companies", icon: Building2, prefix: true },
  { href: "/calendar", label: "Season", icon: CalendarDays },
  { href: "/analysis", label: "Analysis", icon: BarChart3 },
];

const PERSONAL: NavItem[] = [
  { href: "/me", label: "My offers", icon: User },
  { href: "/submit", label: "Add an offer", icon: Plus },
];

const ADMIN: NavItem[] = [
  { href: "/admin/reports", label: "Reports", icon: ShieldAlert, prefix: true },
  { href: "/admin/audit", label: "Audit log", icon: FileText },
];

export type SidebarProps = {
  batches: number[];
  activeBatch: number;
  student: { name: string; srn: string; role: string; branch: string | null };
  pendingReportCount: number;
};

export function Sidebar(props: SidebarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams();

  // A server layout cannot read search params, so the shell resolves the active
  // batch here: the URL wins, and the student's own graduating year is the
  // fallback when they have not chosen one.
  const fromUrl = Number.parseInt(search.get("batch") ?? "", 10);
  const activeBatch = props.batches.includes(fromUrl) ? fromUrl : props.activeBatch;

  // Close the mobile drawer whenever navigation happens, otherwise it stays
  // over the page the user just asked for.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="fixed left-3 top-3 z-30 inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] lg:hidden"
        style={{ background: "var(--panel)", boxShadow: "inset 0 0 0 1px var(--line-strong)" }}
      >
        <Menu size={16} />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[236px] flex-col border-r transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ borderColor: "var(--line)", background: "var(--bg-subtle)" }}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <BatchSwitcher batches={props.batches} active={activeBatch} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="inline-flex size-7 items-center justify-center rounded lg:hidden"
            style={{ color: "var(--text-secondary)" }}
          >
            <X size={15} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          <NavGroup items={PRIMARY} pathname={pathname} />

          <GroupLabel>Yours</GroupLabel>
          <NavGroup items={PERSONAL} pathname={pathname} />

          {props.student.role === "ADMIN" || props.student.role === "SUPER_ADMIN" ? (
            <>
              <GroupLabel>Admin</GroupLabel>
              <NavGroup
                items={ADMIN}
                pathname={pathname}
                badges={{ "/admin/reports": props.pendingReportCount }}
              />
            </>
          ) : null}
        </nav>

        <div className="border-t px-3 py-3" style={{ borderColor: "var(--line)" }}>
          <div className="truncate text-[12px] font-medium">{props.student.name}</div>
          <div className="tnum truncate text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            {props.student.srn}
            {props.student.branch ? ` · ${props.student.branch}` : ""}
          </div>
        </div>
      </aside>
    </>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-2 pb-1 pt-4 text-[11px] font-medium uppercase tracking-[0.06em]"
      style={{ color: "var(--text-tertiary)" }}
    >
      {children}
    </div>
  );
}

function NavGroup({
  items,
  pathname,
  badges,
}: {
  items: NavItem[];
  pathname: string;
  badges?: Record<string, number>;
}) {
  const search = useSearchParams();
  const batch = search.get("batch");

  return (
    <ul className="flex flex-col gap-px">
      {items.map((item) => {
        const active = item.prefix
          ? pathname === item.href || pathname.startsWith(`${item.href}/`)
          : pathname === item.href;
        const Icon = item.icon;
        const badge = badges?.[item.href] ?? 0;
        // Carry the batch across navigation so the shell's selector is not
        // silently reset by every link in it.
        const href = batch ? `${item.href}?batch=${batch}` : item.href;

        return (
          <li key={item.href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className="flex h-[30px] items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-[13px] transition-colors"
              style={{
                background: active ? "var(--accent-subtle)" : "transparent",
                color: active ? "var(--text)" : "var(--text-secondary)",
                fontWeight: active ? 500 : 400,
              }}
            >
              <Icon size={15} style={{ color: active ? "var(--accent)" : "var(--text-tertiary)" }} />
              <span className="flex-1 truncate">{item.label}</span>
              {badge > 0 ? (
                <span
                  className="tnum rounded px-1.5 text-[11px] font-medium"
                  style={{ background: "var(--critical)", color: "#fff" }}
                >
                  {badge}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function BatchSwitcher({ batches, active }: { batches: number[]; active: number }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="relative flex-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-left transition-colors"
        style={{ background: open ? "var(--panel-hover)" : "transparent" }}
      >
        <span
          className="grid size-5 shrink-0 place-items-center rounded text-[10px] font-bold"
          style={{ background: "var(--accent-solid)", color: "var(--accent-fg)" }}
        >
          P
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-tight">
            Batch of {active}
          </span>
        </span>
        <ChevronDown size={14} style={{ color: "var(--text-tertiary)" }} />
      </button>

      {open ? (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-9 z-10 overflow-hidden rounded-[var(--radius-panel)] border py-1"
          style={{
            borderColor: "var(--line-strong)",
            background: "var(--overlay)",
            boxShadow: "var(--shadow-overlay)",
          }}
        >
          {batches.map((year) => (
            <li key={year}>
              <Link
                href={`${pathname}?batch=${year}`}
                role="option"
                aria-selected={year === active}
                className="flex h-7 items-center px-2.5 text-[13px]"
                style={{ color: year === active ? "var(--text)" : "var(--text-secondary)" }}
              >
                Batch of {year}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
