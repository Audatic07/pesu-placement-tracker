import { AdminForm } from "./admin-form";
import { diagnoseServices } from "./actions";
import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { bootstrapOwnerSrn } from "@/lib/admin/access";
import {
  Button,
  PageHeader,
  Panel,
  Stat,
  StatGrid,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operations · PESU Placement Tracker" };

export default async function AdminPage() {
  const actor = await requireRole("ADMIN");
  const [offers, reports, admins, imports] = await Promise.all([
    prisma.offer.count({ where: { deletedAt: null } }),
    prisma.report.count({
      where: { status: { in: ["OPEN", "UNDER_REVIEW"] } },
    }),
    prisma.student.count({
      where: { role: { in: ["ADMIN", "SUPER_ADMIN"] }, isSuspended: false },
    }),
    prisma.auditLog.count({
      where: {
        entityType: { in: ["AdminImport", "PlacementArchive"] },
        action: "IMPORT",
      },
    }),
  ]);
  return (
    <>
      <PageHeader
        title="Operations"
        description="Maintain placement data, review changes and hand the site to the next maintainer."
      />
      <StatGrid>
        <Stat label="Active outcomes" value={String(offers)} />
        <Stat label="Reports to review" value={String(reports)} />
        <Stat label="Active administrators" value={String(admins)} />
        <Stat label="Reviewed imports" value={String(imports)} />
      </StatGrid>
      <div className="max-w-4xl space-y-6 p-6">
        <Panel title="Placement data">
          <div className="space-y-3 p-4 text-[13px]">
            <p>
              Add anonymous historical outcomes for any batch, or edit a
              student's entry with a recorded reason. Admin entry is independent
              of student quotas.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button href="/admin/offers/new" variant="primary">
                Add outcomes
              </Button>
              <Button href="/admin/imports">Import a spreadsheet</Button>
              <Button href="/admin/offers">Edit outcomes</Button>
            </div>
          </div>
        </Panel>
        <Panel title="Service health">
          <div className="space-y-3 p-4 text-[13px]">
            <p>
              Check database response time and the PESU-auth health endpoint.
              Health does not test PESU credentials or guarantee a login will
              succeed.
            </p>
            <AdminForm action={diagnoseServices} label="Check services">
              <span />
            </AdminForm>
          </div>
        </Panel>
        <Panel title="Maintenance">
          <div className="space-y-3 p-4 text-[13px]">
            <p>
              Configure batch policies, archive completed seasons, review the
              audit trail, and export the placement record. Exports contain
              private placement detail and belong outside public repositories.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button href="/admin/batches">Batch settings</Button>
              <Link
                prefetch={false}
                href="/api/export?format=json"
                className="underline"
              >
                Download placement JSON
              </Link>
              <Link
                prefetch={false}
                href="/api/export?format=csv&table=offers"
                className="underline"
              >
                Download outcome CSV
              </Link>
              <Button href="/admin/audit">Audit log</Button>
            </div>
            <p style={{ color: "var(--text-tertiary)" }}>
              These exports are portable placement records. Database disaster
              recovery also requires a PostgreSQL backup from the deployment
              operator.
            </p>
          </div>
        </Panel>
        {actor.role === "SUPER_ADMIN" ? (
          <Panel title="Owner access">
            <div className="space-y-3 p-4 text-[13px]">
              <p>
                Only owners grant roles or suspend accounts. Keep a second owner
                for handover. The deployment recovery account{" "}
                {bootstrapOwnerSrn() ? (
                  <strong className="tnum">{bootstrapOwnerSrn()}</strong>
                ) : (
                  "is not configured"
                )}{" "}
                can regain ownership after a verified PESU login.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button href="/admin/users">Manage access</Button>
                <Button href="/admin/archive">
                  Publish historical archive
                </Button>
                <Link
                  href="/api/admin/backup"
                  prefetch={false}
                  className="underline"
                >
                  Download private database backup
                </Link>
              </div>
              <p style={{ color: "var(--text-tertiary)" }}>
                The backup includes private student identities and audit
                records. Store it securely outside Git. Restore it only into an
                empty migrated database.
              </p>
            </div>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
