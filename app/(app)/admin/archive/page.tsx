import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { ArchiveForm } from "./archive-form";

export const maxDuration = 300;
export const metadata = {
  title: "Historical archive · PESU Placement Tracker",
};

export default async function ArchivePage() {
  await requireRole("SUPER_ADMIN", "/admin/archive");
  const imports = await prisma.auditLog.findMany({
    where: { entityType: "PlacementArchive", action: "IMPORT" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return (
    <>
      <PageHeader
        title="Historical archive"
        description="Publish a prepared archive with its complete compensation and recruiting details."
      />
      <div className="max-w-4xl space-y-6 p-6">
        <Panel title="Before importing">
          <div className="space-y-3 p-4 text-[13px]">
            <p>
              Download a private database backup first. A backup from this owner
              within the last 24 hours is required. Keep it securely outside
              Git.
            </p>
            <Link
              href="/api/admin/backup"
              prefetch={false}
              className="underline"
            >
              Download private database backup
            </Link>
            <p>
              The import adds all batches together and records an audit entry.
              It refuses overlapping historical data. Repeating an identical
              archive adds no duplicates.
            </p>
          </div>
        </Panel>
        <Panel title="Review and publish">
          <div className="p-4">
            <ArchiveForm />
          </div>
        </Panel>
        <Panel title="Published archives">
          <div className="space-y-3 p-4 text-[13px]">
            {imports.length ? (
              imports.map((entry) => (
                <p key={entry.id}>
                  {entry.createdAt.toISOString().slice(0, 10)} · {entry.summary}
                </p>
              ))
            ) : (
              <p>No historical archive has been imported.</p>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
