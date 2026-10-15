import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/rbac";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { TextInput } from "@/components/forms/fields";
import { AdminForm } from "../admin-form";
import { removeImport } from "../actions";
import { ImportForm } from "./import-form";

export const maxDuration = 60;

export default async function ImportsPage() {
  await requireRole("ADMIN");
  const imports = await prisma.auditLog.findMany({
    where: { action: "IMPORT", entityType: "AdminImport" },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return (
    <>
      <PageHeader
        title="Spreadsheet imports"
        description="Download the template, export your sheet as UTF-8 CSV, review the rows, then commit once."
        actions={
          <Link
            prefetch={false}
            href="/api/admin/import-template"
            className="text-[13px] underline"
          >
            Download template
          </Link>
        }
      />
      <div className="max-w-4xl space-y-6 p-6">
        <ImportForm />
        <details className="text-[13px]">
          <summary className="cursor-pointer">Column guide</summary>
          <div className="space-y-2 pt-3">
            <p>
              Required: batch_year, company_name, role_title, cycle,
              source_note. Cycles: FULL_TIME, SIX_MONTH_INTERNSHIP,
              SUMMER_INTERNSHIP.
            </p>
            <p>
              headcount defaults to 1 (maximum 100 per row). ctc_lpa and
              base_lpa are annual lakhs; stipend_inr is monthly rupees. Blank is
              unknown, zero is a stated zero. Dates use YYYY-MM-DD. A
              source_note needs at least five characters.
            </p>
            <p>
              Use INTERNSHIP_ONLY, FTE_ONLY, INTERNSHIP_PLUS_FTE, or
              PPO_CONVERTED in nature. Internship-only rows must leave FTE
              amounts blank. Comma-separated locations and eligible_branches
              need CSV quoting. Optional components_json uses the same JSON
              array as the outcome editor.
            </p>
            <p>
              Each file is committed atomically and receives a fingerprint.
              Repeating an identical file is refused. Changed or overlapping
              files need your review; the app cannot infer whether an anonymous
              headcount is the same group of students.
            </p>
          </div>
        </details>
        <Panel title="Recent imports">
          <div className="space-y-5 p-4 text-[13px]">
            {imports.length ? (
              imports.map((entry) => (
                <details key={entry.id}>
                  <summary className="cursor-pointer">
                    {entry.createdAt.toISOString().slice(0, 10)} ·{" "}
                    {entry.summary}
                  </summary>
                  <div className="pt-3">
                    <AdminForm action={removeImport} label="Undo this import">
                      <input
                        type="hidden"
                        name="digest"
                        value={entry.entityId ?? ""}
                      />
                      <TextInput
                        label="Reason for undo"
                        name="reason"
                        minLength={5}
                        maxLength={500}
                        required
                        hint="Soft-removes this import's anonymous outcomes. Edited imported rows are included; student submissions are preserved. Individual outcomes can be restored from Manage data."
                      />
                    </AdminForm>
                  </div>
                </details>
              ))
            ) : (
              <p>No imports yet.</p>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
