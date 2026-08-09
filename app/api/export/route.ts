import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Full data export.
 *
 * This exists so the data outlives the application. A system meant to run for
 * decades will be rewritten at least once; whoever does that rewrite should be
 * able to take everything out in one request rather than reverse-engineering a
 * schema from a database dump.
 *
 * Admin-only, and every export is audit-logged with who took it — an export is
 * a copy of real students' records leaving the system, which is exactly the
 * kind of action that should leave a trace.
 *
 *   /api/export?format=json
 *   /api/export?format=csv&table=offers
 */
export async function GET(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  const format = request.nextUrl.searchParams.get("format") ?? "json";
  const table = request.nextUrl.searchParams.get("table") ?? "all";

  await recordAudit({
    actorId: admin.id,
    action: "EXPORT",
    entityType: "Dataset",
    summary: `${admin.srn} exported ${table} as ${format}.`,
  });

  if (format === "csv") {
    const { filename, csv } = await buildCsv(table);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const payload = await buildJson();
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="placement-tracker-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
    },
  });
}

async function buildJson() {
  const [batches, companies, drives, offers] = await Promise.all([
    prisma.batch.findMany({
      include: { tierConfigs: true, submissionRule: true, strengths: true },
      orderBy: { year: "asc" },
    }),
    prisma.company.findMany({ include: { aliases: true }, orderBy: { name: "asc" } }),
    prisma.drive.findMany({
      include: {
        roles: { include: { compensation: { include: { components: true } }, rounds: true } },
        funnel: true,
      },
    }),
    // Student identity is deliberately NOT exported alongside offers: the
    // export is of the placement record, not of who is in it. `studentId` is
    // replaced by a stable pseudonym so longitudinal analysis still works.
    prisma.offer.findMany({
      include: { compensation: { include: { components: true } }, rounds: true },
    }),
  ]);

  const pseudonyms = new Map<string, string>();
  const pseudonym = (studentId: string | null) => {
    if (!studentId) return null;
    if (!pseudonyms.has(studentId)) pseudonyms.set(studentId, `S${pseudonyms.size + 1}`);
    return pseudonyms.get(studentId)!;
  };

  return {
    exportedAt: new Date().toISOString(),
    note:
      "Student identities are replaced with per-export pseudonyms. Names, SRNs, e-mail addresses " +
      "and phone numbers are never included.",
    batches,
    companies,
    drives,
    offers: offers.map((offer) => ({
      ...offer,
      studentId: pseudonym(offer.studentId),
      cgpa: offer.cgpa,
    })),
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const lines = rows.map((row) => headers.map((header) => csvCell(row[header])).join(","));
  return `﻿${[headers.join(","), ...lines].join("\r\n")}\r\n`;
}

async function buildCsv(table: string): Promise<{ filename: string; csv: string }> {
  const stamp = new Date().toISOString().slice(0, 10);

  if (table === "offers") {
    const offers = await prisma.offer.findMany({
      where: { deletedAt: null },
      include: {
        company: { select: { name: true } },
        batch: { select: { year: true } },
        branch: { select: { code: true } },
        compensation: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      filename: `offers-${stamp}.csv`,
      csv: toCsv(
        offers.map((offer) => ({
          batch: offer.batch.year,
          company: offer.company.name,
          role: offer.roleTitle,
          role_family: offer.roleFamily,
          cycle: offer.cycle,
          nature: offer.nature,
          tier: offer.tierKey ?? "",
          branch: offer.branch?.code ?? "",
          // Banded, never exact: an export is the most likely way a CGPA would
          // escape the privacy rules the app enforces on screen.
          cgpa_band: offer.cgpaBand ?? "",
          ctc_lpa: offer.compensation?.ctcLpa ?? "",
          base_lpa: offer.compensation?.baseLpa ?? "",
          stipend_inr: offer.compensation?.stipendPerMonthInr ?? "",
          first_year_cash_lpa: offer.compensation?.firstYearCashLpa ?? "",
          verification: offer.verification,
          source: offer.source,
        })),
      ),
    };
  }

  const drives = await prisma.drive.findMany({
    include: {
      company: { select: { name: true } },
      batch: { select: { year: true } },
      roles: { include: { compensation: true } },
    },
  });

  return {
    filename: `drives-${stamp}.csv`,
    csv: toCsv(
      drives.flatMap((drive) =>
        drive.roles.map((role) => ({
          batch: drive.batch.year,
          company: drive.company.name,
          visit: drive.visitNumber,
          cycle: drive.cycle,
          status: drive.status,
          role: role.title,
          role_family: role.roleFamily,
          tier: role.tierKey ?? "",
          eligible_branches: drive.eligibleBranches.join(" "),
          gpa_cutoff_raw: drive.gpaCutoffRaw ?? "",
          gpa_cutoff: role.tierKey ? (drive.gpaCutoffNumeric ?? "") : "",
          ppt_date: drive.pptDate ?? "",
          stipend_inr: role.compensation?.stipendPerMonthInr ?? "",
          base_lpa: role.compensation?.baseLpa ?? "",
          ctc_lpa: role.compensation?.ctcLpa ?? "",
          first_year_cash_lpa: role.compensation?.firstYearCashLpa ?? "",
          placed_internship: role.placedInternship ?? "",
          placed_fte: role.placedFte ?? "",
          placed_both: role.placedBoth ?? "",
        })),
      ),
    ),
  };
}
