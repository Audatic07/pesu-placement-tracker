"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * The unsent draft of the submission form.
 *
 * A student fills this form in once, usually with the offer letter open beside
 * them, and a closed tab or a mis-tapped back button threw all of it away. The
 * draft lives in localStorage: it survives the tab and the browser, never
 * leaves the device, and never reaches the server — the server only ever sees
 * the finished submission, exactly as before. The key carries the student and
 * the batch, so one person's half-typed CGPA is never restored into someone
 * else's form on a shared machine.
 *
 * The form's inputs are uncontrolled, and this leaves them that way. The draft
 * is read from and written into the DOM by field name, in document order, so a
 * repeated name (the component and round rows) round-trips positionally.
 * Checkboxes are recorded by their checked state rather than through FormData,
 * which omits an unchecked box and would shift every later row's value up.
 */

export type DraftFields = Record<string, Array<string | boolean>>;

type StoredDraft = { savedAt: number; fields: DraftFields };

const SAVE_DELAY_MS = 250;

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function controls(form: HTMLFormElement): Control[] {
  return [...form.elements].filter(
    (element): element is Control =>
      (element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement) &&
      element.name !== "" &&
      element.type !== "hidden" &&
      element.type !== "submit",
  );
}

function collect(form: HTMLFormElement): DraftFields {
  const fields: DraftFields = {};
  for (const control of controls(form)) {
    const value =
      control instanceof HTMLInputElement && control.type === "checkbox"
        ? control.checked
        : control.value;
    (fields[control.name] ??= []).push(value);
  }
  return fields;
}

function apply(form: HTMLFormElement, fields: DraftFields): void {
  const seen = new Map<string, number>();
  for (const control of controls(form)) {
    const index = seen.get(control.name) ?? 0;
    seen.set(control.name, index + 1);
    const value = fields[control.name]?.[index];
    if (value === undefined) continue;
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      control.checked = value === true;
    } else if (typeof value === "string") {
      control.value = value;
    }
  }
}

function read(key: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (typeof parsed.savedAt !== "number" || typeof parsed.fields !== "object" || !parsed.fields) {
      return null;
    }
    return { savedAt: parsed.savedAt, fields: parsed.fields };
  } catch {
    // Storage disabled, full, or holding something that is not ours. A draft
    // is a convenience; the form must work without one.
    return null;
  }
}

function write(key: string, fields: DraftFields): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), fields }));
  } catch {
    // Same reasoning as read(): never let the draft break the form.
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to do; there was nothing to remove or nowhere to remove it from.
  }
}

/** How many controls carry a repeated name, for restoring the row count. */
export function rowCount(fields: DraftFields, name: string): number {
  return fields[name]?.length ?? 0;
}

export function useDraft(
  form: RefObject<HTMLFormElement | null>,
  key: string,
  /**
   * Called once with the stored fields before they are applied, so the form
   * can render as many component and round rows as the draft needs. The
   * values themselves are written into the DOM after that render.
   */
  onRestore: (fields: DraftFields) => void,
) {
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const pending = useRef<DraftFields | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitted = useRef(false);

  // Read once, on mount. Deliberately not in render: localStorage is a browser
  // API and the first render also happens on the server.
  useEffect(() => {
    const stored = read(key);
    if (!stored) return;
    pending.current = stored.fields;
    setRestoredAt(stored.savedAt);
    onRestore(stored.fields);
    // onRestore is the form's row setter; re-running this on its identity
    // changing would re-read a draft the student may have since discarded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Apply after whichever render gives the form enough rows. Runs after every
  // render and does nothing once the pending draft has been written.
  useEffect(() => {
    const element = form.current;
    const fields = pending.current;
    if (!element || !fields) return;
    const names = Object.keys(fields);
    const ready = names.every(
      (name) => element.querySelectorAll(`[name="${name}"]`).length >= rowCount(fields, name),
    );
    if (!ready) return;
    apply(element, fields);
    pending.current = null;
  });

  const save = useCallback(() => {
    const element = form.current;
    if (!element || submitted.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => write(key, collect(element)), SAVE_DELAY_MS);
  }, [form, key]);

  // A debounce can lose the last quarter-second before the tab closes; flush
  // it on the way out.
  useEffect(() => {
    const flush = () => {
      const element = form.current;
      if (!element || !timer.current || submitted.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      write(key, collect(element));
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [form, key]);

  const discard = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    remove(key);
    setRestoredAt(null);
  }, [key]);

  /**
   * The draft outlives a failed submission — the student is still on the form
   * with their answers in front of them — and is removed only once an offer
   * has actually been recorded. A successful action redirects away, which
   * unmounts the form; the cleanup below removes the draft then, provided a
   * submission was in flight and no error came back.
   */
  const markSubmitted = useCallback(() => {
    submitted.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const markFailed = useCallback(() => {
    submitted.current = false;
  }, []);

  useEffect(
    () => () => {
      if (submitted.current) remove(key);
    },
    [key],
  );

  return { restoredAt, save, discard, markSubmitted, markFailed };
}
