import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { ReviewLog } from "./lib/review";
import { readScene2026 } from "./sheets/scene2026";
import { readScene2027 } from "./sheets/scene2027";
import {
  readScene2022,
  readScene2023,
  readScene2024,
  readScene2025,
} from "./sheets/historical-configs";
import { loadWorkbook } from "./load";
import { verifyAgainstFooters } from "./verify";
import { recomputeDerivedCompensation } from "../../lib/comp/recompute";
import type { ImportedWorkbook } from "./sheets/types";

/**
 * Historical import — every placement season we hold data for.
 *
 *   npm run import:excel -- --dry-run     parse and report, touch nothing
 *   npm run import:excel                  parse, report, then write
 *   npm run import:excel -- --year=2025   only that season
 *   npm run import:excel -- --force       replace imported drives even when
 *                                         student offers are linked to them
 *
 * Always writes scripts/import/out/import-review.csv. Read it before trusting
 * the result: it lists every judgement the importer made and every fragment it
 * refused to guess at.
 *
 * Every season we hold a sheet for — 2022 through 2027 — is read from its
 * workbook. Each `Placement Scene '<yy>.xlsx` is optional: a season whose file is not
 * present is skipped with a note rather than failing the whole run, so the
 * import works from whichever archives a maintainer has to hand. Each season
 * lands as offer rows in the shape a submission produces (see load.ts), so an
 * archived year reads through the same analytics as a live one.
 *
 * 2027 is being played right now, and importing it is a deliberate reversal of
 * what this comment said before — that a live season waits for its sheet until
 * the season is over. The objection then was hand entry: thirteen companies
 * typed in from memory, with advertised packages and no source anyone could
 * check. The cohort's own workbook answers that part. It does not answer the
 * rest, and the rest is real: a mid-season sheet is a photograph of a race
 * still being run. Its own PPO line is dated "info as of 4/08/2026 — may have
 * changed", a quarter of its companies have no placement figure yet, and some
 * say "IN PROCESS" or "COMING SOON" in the column where a number goes.
 *
 * What makes that importable rather than misleading is that the sheet marks its
 * own gaps and the loader already respects them. A blank headcount is not zero
 * (see `headcount` in scene2026.ts) and produces no offer rows, so a company
 * still interviewing contributes its drive and its dates — the calendar and the
 * directory's `visited` facet — and contributes nothing to any figure derived
 * from offers. Nobody is counted as placed until the sheet says they were.
 *
 * What it cannot do is stay correct on its own. Re-run it as the season fills
 * in; the load is idempotent per batch.
 */

const REVIEW_PATH = resolve("scripts/import/out/import-review.csv");

/** A season and how to obtain its parsed workbook. */
type Source = {
  batchYear: number;
  file: { envVar: string; defaultPath: string };
  read: (workbook: ExcelJS.Workbook, review: ReviewLog) => ImportedWorkbook;
};

const SOURCES: Source[] = [
  {
    batchYear: 2022,
    file: { envVar: "IMPORT_XLSX_2022", defaultPath: "./Placement Scene '22.xlsx" },
    read: readScene2022,
  },
  {
    batchYear: 2023,
    file: { envVar: "IMPORT_XLSX_2023", defaultPath: "./Placement Scene '23.xlsx" },
    read: readScene2023,
  },
  {
    batchYear: 2024,
    file: { envVar: "IMPORT_XLSX_2024", defaultPath: "./Placement Scene '24.xlsx" },
    read: readScene2024,
  },
  {
    batchYear: 2025,
    file: { envVar: "IMPORT_XLSX_2025", defaultPath: "./Placement Scene '25.xlsx" },
    read: readScene2025,
  },
  {
    batchYear: 2026,
    file: { envVar: "IMPORT_XLSX_2026", defaultPath: "./Placement Scene '26.xlsx" },
    read: readScene2026,
  },
  {
    batchYear: 2027,
    file: { envVar: "IMPORT_XLSX_2027", defaultPath: "./Placement Scene '27.xlsx" },
    read: readScene2027,
  },
];

function arg(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/**
 * The one season named by --year=NNNN, or null for "all of them".
 *
 * The format is checked here rather than left to `parseInt`, which reads
 * `--year=22` as 22 and `--year=2026x` as 2026. Both would then fail further
 * down with "No importer is defined for batch 22", which is true but tells the
 * reader nothing about the typo that caused it.
 */
function requestedYear(): number | null {
  const flag = process.argv.find((value) => value.startsWith("--year="));
  if (!flag) return null;
  const value = flag.slice("--year=".length);
  if (!/^\d{4}$/.test(value)) {
    throw new Error(`--year expects a 4-digit year, got "${flag}".`);
  }
  return Number.parseInt(value, 10);
}

async function openWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook;
}

function summarise(parsed: ImportedWorkbook): void {
  const roles = parsed.drives.flatMap((drive) => drive.roles);
  const rounds = roles.flatMap((role) => role.rounds);
  const components = roles.flatMap((role) => role.components);

  const withCtc = roles.filter((role) => role.ctcLpa !== null).length;
  const withStipend = roles.filter((role) => role.stipendPerMonthInr !== null).length;
  const knownMode = rounds.filter((round) => round.mode !== "UNKNOWN").length;

  console.log(`\n  batch ${parsed.batchYear}`);
  console.log(`    drives                ${parsed.drives.length}`);
  console.log(`    roles                 ${roles.length}`);
  console.log(`    roles with a CTC      ${withCtc}`);
  console.log(`    roles with a stipend  ${withStipend}`);
  console.log(`    interview rounds      ${rounds.length} (${knownMode} with a known online/in-person mode)`);
  console.log(`    comp components       ${components.length}`);

  // Only the colour-coded workbooks carry these; the older sheets encode
  // nothing in fill, so a line of zeros would say nothing about them.
  const flagged = {
    repeat: parsed.drives.filter((d) => d.flags.isRepeatCompany).length,
    tenPlus: parsed.drives.filter((d) => d.flags.hiredTenPlus).length,
    mass: parsed.drives.filter((d) => d.flags.massHired).length,
    nobody: parsed.drives.filter((d) => d.flags.hiredNobody).length,
    ditched: parsed.drives.filter((d) => d.flags.ditched).length,
  };
  if (Object.values(flagged).some((count) => count > 0)) {
    console.log(
      `    colour-coded flags    repeat ${flagged.repeat} · hired 10+ ${flagged.tenPlus} · ` +
        `mass hire ${flagged.mass} · hired nobody ${flagged.nobody} · ditched ${flagged.ditched}`,
    );
  }
}

/**
 * Parses one season if its file is available. Returns null when a file-based
 * season's workbook is not present, so the caller can skip it.
 *
 * Unless the caller asked for that season by name. A bare run imports whatever
 * is on disk, and skipping the rest is the point; `--year=2024` is a request,
 * and answering a request for one season with a clean exit and no rows is how
 * someone concludes the importer ran and their data is missing.
 */
async function parseSource(
  source: Source,
  review: ReviewLog,
  namedExplicitly: boolean,
): Promise<ImportedWorkbook | null> {
  const path = process.env[source.file.envVar] ?? source.file.defaultPath;
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    if (namedExplicitly) {
      throw new Error(
        `--year=${source.batchYear} was asked for, but there is no workbook at ${path}. ` +
          `Set ${source.file.envVar} to its location, or drop the flag to import the seasons ` +
          `whose workbooks are present.`,
      );
    }
    console.log(`\n  batch ${source.batchYear}: no workbook at ${path} — skipped.`);
    return null;
  }

  const workbook = await openWorkbook(resolved);
  return source.read(workbook, review);
}

async function main() {
  const dryRun = arg("dry-run");
  const only = requestedYear();
  const review = new ReviewLog();

  const sources = only ? SOURCES.filter((source) => source.batchYear === only) : SOURCES;
  if (sources.length === 0) {
    throw new Error(`No importer is defined for batch ${only}.`);
  }

  console.log(dryRun ? "Parsing (dry run — nothing will be written)…" : "Importing…");

  const parsedWorkbooks: ImportedWorkbook[] = [];
  for (const source of sources) {
    const parsed = await parseSource(source, review, only !== null);
    if (!parsed) continue;
    summarise(parsed);
    parsedWorkbooks.push(parsed);
  }

  console.log("\n  review log");
  const bySeverity = review.countBySeverity();
  console.log(
    `    ${review.size} entries — ${bySeverity.DECIDED} decided, ` +
      `${bySeverity.UNRESOLVED} unresolved, ${bySeverity.DROPPED} dropped`,
  );
  for (const [field, count] of review.countByField().slice(0, 8)) {
    console.log(`      ${String(count).padStart(4)}  ${field}`);
  }

  await review.writeCsv(REVIEW_PATH);
  console.log(`\n  written to ${REVIEW_PATH}`);

  if (dryRun) {
    console.log("\nDry run complete. Nothing was written to the database.");
    return;
  }

  if (parsedWorkbooks.length === 0) {
    console.log("\nNo workbooks were available to import.");
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  let allVerified = true;
  try {
    console.log("\nWriting to the database…");
    for (const parsed of parsedWorkbooks) {
      const result = await loadWorkbook(prisma, parsed, review);
      console.log(
        `  batch ${parsed.batchYear}: ${result.companies} companies, ` +
          `${result.drives} drives, ${result.roles} roles, ${result.rounds} rounds, ` +
          `${result.offers} offers`,
      );
    }

    await review.writeCsv(REVIEW_PATH);
    console.log(`  review log rewritten with load-time entries (${review.size} total)`);

    const derived = await recomputeDerivedCompensation(prisma);
    console.log(
      `  derived figures recomputed for ${derived.packagesUpdated} packages` +
        (derived.financialYear
          ? ` using the ${derived.financialYear} tax slabs`
          : " (no tax configuration found, so no take-home estimates)"),
    );

    // Every season is verified, not only the one with a footer. Only the 2026
    // workbook publishes totals to re-derive, so the older sheets get "?" for
    // each footer check — but the headcount-versus-offer-rows check compares
    // the database with itself and needs no footer. It is the one fidelity
    // check those seasons have, and skipping the whole report for them would
    // have silently skipped it.
    for (const parsed of parsedWorkbooks) {
      console.log(
        parsed.footers.length > 0
          ? `\nVerifying batch ${parsed.batchYear} against the sheet's own totals…`
          : `\nVerifying batch ${parsed.batchYear} against its own headcounts (the sheet publishes no totals)…`,
      );
      const report = await verifyAgainstFooters(prisma, parsed);
      console.log(report.text);
      if (!report.allMatched) allVerified = false;
    }
  } finally {
    await prisma.$disconnect();
  }

  if (!allVerified) {
    process.exitCode = 1;
    console.log(
      "\nSome totals do not match the source. The import is NOT trustworthy until they do.",
    );
  }
}

main().catch((error) => {
  console.error("\nImport failed:", error);
  process.exitCode = 1;
});
