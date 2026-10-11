import { AdminOfferInput, type AdminOfferValues } from "./input";

export const IMPORT_COLUMNS = [
  "batch_year",
  "company_name",
  "role_title",
  "cycle",
  "nature",
  "headcount",
  "ctc_lpa",
  "base_lpa",
  "stipend_inr",
  "branch",
  "offer_date",
  "notes",
  "source_note",
  "role_family",
  "work_mode",
  "locations",
  "acceptance_status",
  "announced_cgpa_cutoff",
  "bond_months",
  "internship_months",
  "eligible_branches",
  "components_json",
] as const;
export const MAX_IMPORT_BYTES = 512_000;
export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_OUTCOMES = 500;

/** Bounded RFC-style CSV decoding, including quoted newlines and doubled quotes. */
export function parseCsv(text: string): string[][] {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES)
    throw new Error("Use a CSV smaller than 500 KB.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const pushCell = () => {
    row.push(cell);
    cell = "";
    closed = false;
    if (row.length > IMPORT_COLUMNS.length)
      throw new Error("Too many columns.");
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
    if (rows.length > MAX_IMPORT_ROWS + 1)
      throw new Error(`Use at most ${MAX_IMPORT_ROWS} data rows per import.`);
  };
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === ",") pushCell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else if (char === '"' && cell === "" && !closed) quoted = true;
    else if (closed || char === '"')
      throw new Error("Invalid CSV quoting. Export the sheet as UTF-8 CSV.");
    else cell += char;
  }
  if (quoted) throw new Error("A quoted CSV field was not closed.");
  if (cell || row.length || closed) pushRow();
  return rows;
}

export function csvCell(value: unknown): string {
  let text =
    value == null
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  // Spreadsheet programs must not execute an administrator's exported text.
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function importTemplate(): string {
  return `${IMPORT_COLUMNS.join(",")}\r\n`;
}

export function decodeImport(text: string): {
  rows: AdminOfferValues[];
  errors: string[];
  outcomes: number;
} {
  const table = parseCsv(text);
  const headers = table.shift()?.map((s) => s.trim()) ?? [];
  if (!headers.length) throw new Error("The file is empty.");
  const allowed = new Set<string>(IMPORT_COLUMNS);
  if (new Set(headers).size !== headers.length)
    throw new Error("The sheet contains duplicate column headings.");
  if (headers.some((header) => !allowed.has(header)))
    throw new Error("Unknown columns. Download and use the import template.");
  for (const required of [
    "batch_year",
    "company_name",
    "role_title",
    "cycle",
    "source_note",
  ]) {
    if (!headers.includes(required))
      throw new Error(`Missing column: ${required}.`);
  }
  const rows: AdminOfferValues[] = [],
    errors: string[] = [];
  let outcomes = 0;
  for (const [index, cells] of table.entries()) {
    if (cells.length !== headers.length) {
      errors.push(`Row ${index + 2}: column count does not match the header.`);
      continue;
    }
    const record = Object.fromEntries(
      headers.map((header, i) => [header, cells[i]!.trim()]),
    );
    const value = (key: string) => record[key] || undefined;
    const list = (key: string) =>
      (record[key] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    let components: unknown;
    try {
      components = value("components_json")
        ? JSON.parse(record.components_json!)
        : undefined;
    } catch {
      errors.push(`Row ${index + 2}: components_json must be a JSON array.`);
      continue;
    }
    const result = AdminOfferInput.safeParse({
      batchYear: value("batch_year"),
      companyName: value("company_name"),
      roleTitle: value("role_title"),
      cycle: value("cycle"),
      nature:
        value("nature") ??
        (record.cycle === "FULL_TIME" ? "FTE_ONLY" : "INTERNSHIP_ONLY"),
      headcount: value("headcount") ?? 1,
      ctcLpa: value("ctc_lpa"),
      baseLpa: value("base_lpa"),
      stipendPerMonthInr: value("stipend_inr"),
      branchCode: value("branch"),
      offerDate: value("offer_date"),
      processNotes: value("notes"),
      reason: value("source_note"),
      roleFamily: value("role_family"),
      workMode: value("work_mode"),
      locations: list("locations"),
      acceptanceStatus: value("acceptance_status"),
      announcedCgpaCutoff: value("announced_cgpa_cutoff"),
      bondMonths: value("bond_months"),
      internshipDurationMonths: value("internship_months"),
      eligibleBranches: list("eligible_branches"),
      components,
    });
    if (result.success) {
      rows.push(result.data);
      outcomes += result.data.headcount;
    } else
      errors.push(
        `Row ${index + 2}: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      );
  }
  if (!table.length)
    errors.push("Add at least one data row below the headings.");
  if (outcomes > MAX_IMPORT_OUTCOMES)
    errors.push(
      `Use at most ${MAX_IMPORT_OUTCOMES} outcomes per import; split larger sheets.`,
    );
  return { rows, errors, outcomes };
}
