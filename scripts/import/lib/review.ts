import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * The human-review log.
 *
 * This importer refuses to guess. Every judgement call it could not make with
 * confidence — an ambiguous date, an unattributed amount, a company name that
 * looks like one already in the database — is recorded here and written to a
 * CSV for someone to read before the import is trusted.
 *
 * The alternative is an import that looks clean and is quietly wrong in eleven
 * places, which is precisely the failure mode the spreadsheets already have.
 */

export type ReviewSeverity =
  /** The importer made a choice that a human should confirm. */
  | "DECIDED"
  /** The importer could not choose; the field was left empty. */
  | "UNRESOLVED"
  /** Information was dropped or could not be represented. */
  | "DROPPED";

export type ReviewEntry = {
  severity: ReviewSeverity;
  sheet: string;
  row: number | null;
  company: string | null;
  field: string;
  rawValue: string;
  outcome: string;
  reason: string;
};

export class ReviewLog {
  private readonly entries: ReviewEntry[] = [];

  add(entry: ReviewEntry): void {
    this.entries.push(entry);
  }

  get size(): number {
    return this.entries.length;
  }

  countBySeverity(): Record<ReviewSeverity, number> {
    const counts: Record<ReviewSeverity, number> = {
      DECIDED: 0,
      UNRESOLVED: 0,
      DROPPED: 0,
    };
    for (const entry of this.entries) counts[entry.severity] += 1;
    return counts;
  }

  countByField(): Array<[string, number]> {
    const counts = new Map<string, number>();
    for (const entry of this.entries) {
      counts.set(entry.field, (counts.get(entry.field) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }

  async writeCsv(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });

    const header = [
      "severity",
      "sheet",
      "row",
      "company",
      "field",
      "raw_value",
      "outcome",
      "reason",
    ];

    const rows = this.entries
      .slice()
      .sort(
        (a, b) =>
          a.sheet.localeCompare(b.sheet) ||
          (a.row ?? 0) - (b.row ?? 0) ||
          a.field.localeCompare(b.field),
      )
      .map((entry) =>
        [
          entry.severity,
          entry.sheet,
          entry.row ?? "",
          entry.company ?? "",
          entry.field,
          entry.rawValue,
          entry.outcome,
          entry.reason,
        ]
          .map(csvCell)
          .join(","),
      );

    // BOM so Excel opens the file as UTF-8 rather than mangling company names.
    await writeFile(path, `﻿${[header.join(","), ...rows].join("\r\n")}\r\n`, "utf8");
  }
}

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
