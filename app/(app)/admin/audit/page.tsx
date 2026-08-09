import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { EmptyState, PageHeader, StatusBadge, Tag, type Tone } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log · PESU Placement Tracker" };

const ACTION_TONE: Record<string, Tone> = {
  CREATE: "good",
  UPDATE: "neutral",
  SOFT_DELETE: "critical",
  RESTORE: "warning",
  ROLE_GRANT: "accent",
  ROLE_REVOKE: "critical",
  REPORT_RESOLVE: "accent",
  CONFIG_CHANGE: "warning",
  IMPORT: "neutral",
  LOGIN: "neutral",
  EXPORT: "warning",
};

/**
 * The audit log.
 *
 * Append-only and read-only — there is no code path that edits or deletes a
 * row here, and deliberately no filter that could make an entry disappear from
 * view. A moderation decision nobody can review later is indistinguishable from
 * censorship, and this system is meant to be handed to a stranger in ten years.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireRole("ADMIN");
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params["page"] ?? "1", 10) || 1);
  const pageSize = 100;

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      include: { actor: { select: { srn: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count(),
  ]);

  return (
    <>
      <PageHeader
        title="Audit log"
        description={`Every consequential action, oldest preserved forever. ${total.toLocaleString("en-IN")} entries. Nothing here can be edited or deleted, including by you.`}
      />

      {entries.length === 0 ? (
        <EmptyState title="Nothing recorded yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0" style={{ background: "var(--bg)" }}>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                {["When", "Who", "Action", "Entity", "What happened"].map((heading) => (
                  <th
                    key={heading}
                    className="h-8 whitespace-nowrap px-4 text-left text-[11px] font-medium uppercase tracking-[0.05em]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td className="tnum h-[34px] whitespace-nowrap px-4" style={{ color: "var(--text-tertiary)" }}>
                    {entry.createdAt.toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="tnum whitespace-nowrap px-4">
                    {entry.actor?.srn ?? <span style={{ color: "var(--text-tertiary)" }}>system</span>}
                  </td>
                  <td className="whitespace-nowrap px-4">
                    <StatusBadge tone={ACTION_TONE[entry.action] ?? "neutral"}>
                      {entry.action.replace(/_/g, " ").toLowerCase()}
                    </StatusBadge>
                  </td>
                  <td className="whitespace-nowrap px-4">
                    <Tag>{entry.entityType}</Tag>
                  </td>
                  <td className="px-4" style={{ color: "var(--text-secondary)" }}>
                    {entry.summary ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > pageSize ? (
        <div
          className="flex items-center justify-between border-t px-6 py-2.5 text-[12px]"
          style={{ borderColor: "var(--line)", color: "var(--text-tertiary)" }}
        >
          <span className="tnum">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of{" "}
            {total.toLocaleString("en-IN")}
          </span>
          <span className="flex gap-3">
            {page > 1 ? <a href={`/admin/audit?page=${page - 1}`}>Newer</a> : null}
            {page * pageSize < total ? <a href={`/admin/audit?page=${page + 1}`}>Older</a> : null}
          </span>
        </div>
      ) : null}
    </>
  );
}
