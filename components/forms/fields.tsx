"use client";

import { useId, type ReactNode } from "react";

/**
 * Form fields.
 *
 * One control style, one label style, one error style. A dense tool form should
 * look like the tables around it: hairline borders, 30px controls, labels above
 * rather than floating.
 */

const CONTROL =
  "h-[30px] w-full rounded-[var(--radius-control)] px-2 text-[13px] outline-none transition-shadow";

function controlStyle(invalid?: boolean) {
  return {
    background: "var(--panel)",
    color: "var(--text)",
    boxShadow: `inset 0 0 0 1px ${invalid ? "var(--critical)" : "var(--line-strong)"}`,
  };
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[12px] font-medium">
        {label}
        {required ? (
          <span aria-hidden style={{ color: "var(--text-tertiary)" }}>
            {" "}
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[12px]" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  label,
  name,
  hint,
  error,
  required,
  type = "text",
  ...rest
}: {
  label: string;
  name: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  type?: string;
} & Record<string, unknown>) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={id}>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        className={`${CONTROL} ${type === "number" ? "tnum" : ""}`}
        style={controlStyle(Boolean(error))}
        {...rest}
      />
    </Field>
  );
}

export function Select({
  label,
  name,
  options,
  hint,
  error,
  required,
  defaultValue,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={id}>
      <select
        id={id}
        name={name}
        required={required}
        defaultValue={defaultValue}
        className={CONTROL}
        style={controlStyle(Boolean(error))}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function TextArea({
  label,
  name,
  hint,
  rows = 4,
  placeholder,
}: {
  label: string;
  name: string;
  hint?: ReactNode;
  rows?: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <textarea
        id={id}
        name={name}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-[var(--radius-control)] px-2 py-1.5 text-[13px] leading-relaxed outline-none"
        style={controlStyle()}
      />
    </Field>
  );
}

export function Checkbox({
  label,
  name,
  hint,
  defaultChecked,
}: {
  label: string;
  name: string;
  hint?: ReactNode;
  defaultChecked?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="mt-0.5 size-[15px] shrink-0 accent-[var(--accent-solid)]"
      />
      <label htmlFor={id} className="text-[13px] leading-snug">
        {label}
        {hint ? (
          <span className="mt-0.5 block text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            {hint}
          </span>
        ) : null}
      </label>
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
  columns = 2,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  const grid =
    columns === 1
      ? "grid-cols-1"
      : columns === 3
        ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        : "grid-cols-1 sm:grid-cols-2";

  return (
    <section
      className="rounded-[var(--radius-panel)] border"
      style={{ borderColor: "var(--line)", background: "var(--panel)" }}
    >
      <header className="border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
        <h2 className="text-[13px] font-medium">{title}</h2>
        {description ? (
          <p className="mt-0.5 max-w-[70ch] text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            {description}
          </p>
        ) : null}
      </header>
      <div className={`grid gap-4 p-4 ${grid}`}>{children}</div>
    </section>
  );
}
