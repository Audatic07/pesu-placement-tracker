"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

/**
 * Filters, held in the URL.
 *
 * Every control here writes to the query string rather than to component state.
 * That is the whole design: a filtered view is a link, the back button undoes a
 * filter, a refresh keeps the view, and a student can paste "tier 1 companies
 * open to ECE that hired someone" into a group chat and have it survive.
 *
 * Navigation runs inside a transition so the table dims rather than blanks
 * while the server re-queries.
 */

export type FacetOption = { key: string; label: string; count: number };

function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const apply = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(search.toString());
      mutate(params);
      // Any change to the result set invalidates the current page number.
      params.delete("page");
      const query = params.toString();
      startTransition(() => {
        router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [router, pathname, search],
  );

  return { search, apply, pending };
}

export function FilterBar({
  facets,
  searchPlaceholder = "Search companies…",
  children,
}: {
  facets: Array<{ param: string; label: string; options: FacetOption[] }>;
  searchPlaceholder?: string;
  children?: React.ReactNode;
}) {
  const { search, apply, pending } = useUrlState();
  const activeCount = facets.reduce(
    (sum, facet) => sum + (search.get(facet.param)?.split(",").filter(Boolean).length ?? 0),
    0,
  );

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b px-6 py-2.5"
      style={{ borderColor: "var(--line)", opacity: pending ? 0.6 : 1 }}
    >
      <SearchBox placeholder={searchPlaceholder} />

      {facets
        .filter((facet) => facet.options.length > 0)
        .map((facet) => (
          <FacetMenu
            key={facet.param}
            param={facet.param}
            label={facet.label}
            options={facet.options}
          />
        ))}

      {children}

      {activeCount > 0 || search.get("q") ? (
        <button
          type="button"
          onClick={() =>
            apply((params) => {
              for (const facet of facets) params.delete(facet.param);
              params.delete("q");
            })
          }
          className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] px-2 text-[12px]"
          style={{ color: "var(--text-secondary)" }}
        >
          <X size={13} />
          Clear
        </button>
      ) : null}
    </div>
  );
}

function SearchBox({ placeholder }: { placeholder: string }) {
  const { search, apply } = useUrlState();
  const [value, setValue] = useState(search.get("q") ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const initial = useRef(true);

  // Keep in step when the URL changes from elsewhere (back button, Clear).
  useEffect(() => {
    setValue(search.get("q") ?? "");
  }, [search]);

  // Debounced: typing should not push a history entry per keystroke.
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    const timer = setTimeout(() => {
      if ((search.get("q") ?? "") === value) return;
      apply((params) => {
        if (value.trim()) params.set("q", value.trim());
        else params.delete("q");
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [value, apply, search]);

  // "/" focuses search, the convention in every dense tool.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative">
      <Search
        size={13}
        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
        style={{ color: "var(--text-tertiary)" }}
      />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-7 w-[190px] rounded-[var(--radius-control)] pl-7 pr-2 text-[13px] outline-none"
        style={{
          background: "var(--panel)",
          color: "var(--text)",
          boxShadow: "inset 0 0 0 1px var(--line-strong)",
        }}
      />
    </div>
  );
}

function FacetMenu({
  param,
  label,
  options,
}: {
  param: string;
  label: string;
  options: FacetOption[];
}) {
  const { search, apply } = useUrlState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = new Set((search.get(param) ?? "").split(",").filter(Boolean));

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply((params) => {
      if (next.size === 0) params.delete(param);
      else params.set(param, [...next].join(","));
    });
  };

  const summary =
    selected.size === 0
      ? label
      : selected.size === 1
        ? (options.find((option) => option.key === [...selected][0])?.label ?? label)
        : `${label}: ${selected.size}`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-[12px] transition-colors"
        style={{
          background: selected.size > 0 ? "var(--accent-subtle)" : "var(--panel)",
          color: selected.size > 0 ? "var(--text)" : "var(--text-secondary)",
          boxShadow: `inset 0 0 0 1px ${selected.size > 0 ? "transparent" : "var(--line-strong)"}`,
        }}
      >
        {summary}
        <ChevronDown size={12} />
      </button>

      {open ? (
        <div
          className="absolute left-0 top-8 z-20 max-h-[280px] w-[210px] overflow-y-auto rounded-[var(--radius-panel)] border py-1"
          style={{
            borderColor: "var(--line-strong)",
            background: "var(--overlay)",
            boxShadow: "var(--shadow-overlay)",
          }}
        >
          {options.map((option) => {
            const isOn = selected.has(option.key);
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => toggle(option.key)}
                // A zero-count option is kept visible but disabled: hiding it
                // makes the filter list jump around as you use it.
                disabled={option.count === 0 && !isOn}
                className="flex h-7 w-full items-center gap-2 px-2.5 text-left text-[13px] disabled:opacity-40"
                style={{ color: "var(--text-secondary)" }}
              >
                <span
                  className="grid size-[14px] shrink-0 place-items-center rounded-[3px]"
                  style={{
                    background: isOn ? "var(--accent)" : "transparent",
                    boxShadow: isOn ? "none" : "inset 0 0 0 1px var(--line-strong)",
                  }}
                >
                  {isOn ? <Check size={10} color="#fff" /> : null}
                </span>
                <span className="flex-1 truncate" style={{ color: isOn ? "var(--text)" : undefined }}>
                  {option.label}
                </span>
                <span className="tnum text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {option.count}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
