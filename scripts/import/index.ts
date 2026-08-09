import "dotenv/config";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { ReviewLog } from "./lib/review";
import { readScene2026 } from "./sheets/scene2026";
import { loadWorkbook } from "./load";
import { verifyAgainstFooters } from "./verify";
import { recomputeDerivedCompensation } from "../../lib/comp/recompute";
import type { ImportedWorkbook } from "./sheets/types";

/**
 * Historical import — the 2026 workbook, and only that one.
 *
 *   npm run import:excel -- --dry-run     parse and report, touch nothing
 *   npm run import:excel                  parse, report, then write
 *
 * Always writes scripts/import/out/import-review.csv. Read it before trusting
 * the result: it lists every judgement the importer made and every fragment it
 * refused to guess at.
 *
 * 2026 is the archive: a finished season, recorded by hand in a spreadsheet
 * that nobody will update again. Importing it gives every recruiter a
 * previous-years section on its profile and seeds the company list, so the
 * first student to file against 2027 is not typing into an empty database.
 *
 * 2027 is deliberately NOT imported, even though a partial sheet for it exists.
 * That season is still being played, and a half-finished spreadsheet would seed
 * the batch with company-published headcounts that students would then have to
 * argue with. A batch nobody has reported on should say so plainly rather than
 * show numbers no student confirmed. The parser for that sheet is in git
 * history if a future maintainer ever wants it back.
 */

const REVIEW_PATH = resolve("scripts/import/out/import-review.csv");

function arg(name: string): boolean {
  return process.argv.includes(`--${name}`);
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

  const flagged = {
    repeat: parsed.drives.filter((d) => d.flags.isRepeatCompany).length,
    tenPlus: parsed.drives.filter((d) => d.flags.hiredTenPlus).length,
    mass: parsed.drives.filter((d) => d.flags.massHired).length,
    nobody: parsed.drives.filter((d) => d.flags.hiredNobody).length,
    ditched: parsed.drives.filter((d) => d.flags.ditched).length,
  };
  console.log(
    `    colour-coded flags    repeat ${flagged.repeat} · hired 10+ ${flagged.tenPlus} · ` +
      `mass hire ${flagged.mass} · hired nobody ${flagged.nobody} · ditched ${flagged.ditched}`,
  );
}

async function main() {
  const dryRun = arg("dry-run");
  const review = new ReviewLog();

  const path2026 = process.env.IMPORT_XLSX_2026 ?? "./Placement Scene '26.xlsx";

  console.log(dryRun ? "Parsing (dry run — nothing will be written)…" : "Importing…");

  const wb2026 = await openWorkbook(resolve(path2026));
  const parsed2026 = readScene2026(wb2026, review);

  summarise(parsed2026);

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

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    console.log("\nWriting to the database…");
    const result = await loadWorkbook(prisma, parsed2026, review);
    console.log(
      `  batch ${parsed2026.batchYear}: ${result.companies} companies, ` +
        `${result.drives} drives, ${result.roles} roles, ${result.rounds} rounds`,
    );

    await review.writeCsv(REVIEW_PATH);
    console.log(`  review log rewritten with load-time entries (${review.size} total)`);

    const derived = await recomputeDerivedCompensation(prisma);
    console.log(
      `  derived figures recomputed for ${derived.packagesUpdated} packages` +
        (derived.financialYear
          ? ` using the ${derived.financialYear} tax slabs`
          : " (no tax configuration found, so no take-home estimates)"),
    );

    console.log("\nVerifying against the sheets' own totals…");
    const report = await verifyAgainstFooters(prisma, parsed2026);
    console.log(report.text);
    if (!report.allMatched) {
      process.exitCode = 1;
      console.log(
        "\nSome totals do not match the source. The import is NOT trustworthy until they do.",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nImport failed:", error);
  process.exitCode = 1;
});
