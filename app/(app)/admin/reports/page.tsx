import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import {
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
  Tag,
  formatLpa,
} from "@/components/ui/primitives";
import { ModerationForm } from "./moderation-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports · PESU Placement Tracker" };

const REASON: Record<string, string> = {
  INFLATED_CTC: "Package looks inflated",
  FAKE_OFFER: "Possibly not a real offer",
  WRONG_COMPANY: "Wrong company or role",
  DUPLICATE: "Duplicate entry",
  PRIVACY_VIOLATION: "Identifies someone without consent",
  ABUSE: "Abusive content",
  OTHER: "Other",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireRole("ADMIN");
  const params = await searchParams;
  const showResolved = params["show"] === "resolved";

  const reports = await prisma.report.findMany({
    where: showResolved
      ? { status: { in: ["UPHELD", "REJECTED"] } }
      : { status: { in: ["OPEN", "UNDER_REVIEW"] } },
    include: {
      reporter: { select: { srn: true, name: true } },
      resolvedBy: { select: { srn: true } },
      offer: {
        include: {
          company: { select: { name: true, slug: true } },
          batch: { select: { year: true } },
          student: { select: { srn: true, name: true } },
          compensation: { select: { ctcLpa: true, firstYearCashLpa: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Group by offer: several reports on one entry are one decision, not several.
  const byOffer = new Map<string, typeof reports>();
  for (const report of reports) {
    const bucket = byOffer.get(report.offerId);
    if (bucket) bucket.push(report);
    else byOffer.set(report.offerId, [report]);
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="Every decision here is written to the audit log with a before-and-after snapshot. Removing an entry hides it; it never destroys it."
        actions={
          <div className="flex items-center gap-1">
            <Link
              href="/admin/reports"
              className="h-8 rounded-[var(--radius-control)] px-2.5 text-[13px] leading-8"
              style={{
                background: showResolved ? "transparent" : "var(--accent-subtle)",
                color: showResolved ? "var(--text-secondary)" : "var(--text)",
              }}
            >
              Open
            </Link>
            <Link
              href="/admin/reports?show=resolved"
              className="h-8 rounded-[var(--radius-control)] px-2.5 text-[13px] leading-8"
              style={{
                background: showResolved ? "var(--accent-subtle)" : "transparent",
                color: showResolved ? "var(--text)" : "var(--text-secondary)",
              }}
            >
              Resolved
            </Link>
          </div>
        }
      />

      <div className="flex max-w-4xl flex-col gap-4 p-6">
        {byOffer.size === 0 ? (
          <Panel>
            <EmptyState
              title={showResolved ? "Nothing resolved yet" : "Nothing waiting"}
              description={
                showResolved
                  ? "Decisions you make will be listed here, with who made them and when."
                  : "No entries have been reported. This is where they will appear."
              }
            />
          </Panel>
        ) : null}

        {[...byOffer.entries()].map(([offerId, group]) => {
          const first = group[0]!;
          const offer = first.offer;

          return (
            <Panel
              key={offerId}
              title={`${offer.company.name} — ${offer.roleTitle}`}
              description={`Batch of ${offer.batch.year} · ${group.length} report${group.length === 1 ? "" : "s"}`}
              actions={
                offer.deletedAt ? (
                  <StatusBadge tone="critical">Removed</StatusBadge>
                ) : (
                  <StatusBadge tone={offer.verification === "DISPUTED" ? "warning" : "neutral"}>
                    {offer.verification === "DISPUTED" ? "Disputed" : "Visible"}
                  </StatusBadge>
                )
              }
              padded={false}
            >
              <div
                className="flex flex-wrap gap-x-8 gap-y-2 border-b px-4 py-3 text-[12px]"
                style={{ borderColor: "var(--line)" }}
              >
                <Fact label="Reported CTC">
                  {formatLpa(offer.compensation?.ctcLpa ? Number(offer.compensation.ctcLpa) : null)}
                </Fact>
                <Fact label="Cash, year 1">
                  {formatLpa(
                    offer.compensation?.firstYearCashLpa
                      ? Number(offer.compensation.firstYearCashLpa)
                      : null,
                  )}
                </Fact>
                <Fact label="Submitted by">
                  {offer.student ? `${offer.student.name} (${offer.student.srn})` : "Imported record"}
                </Fact>
                <Fact label="Entry">
                  <Link href={`/offers/${offerId}`} className="underline underline-offset-2">
                    Open
                  </Link>
                </Fact>
              </div>

              <ul>
                {group.map((report) => (
                  <li
                    key={report.id}
                    className="px-4 py-3"
                    style={{ borderBottom: "1px solid var(--line)" }}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <Tag>{REASON[report.reason] ?? report.reason}</Tag>
                      <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                        {report.reporter
                          ? `${report.reporter.srn} · `
                          : "reporter removed · "}
                        {report.createdAt.toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      {report.status !== "OPEN" && report.status !== "UNDER_REVIEW" ? (
                        <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                          {report.status === "UPHELD" ? "upheld" : "rejected"}
                          {report.resolvedBy ? ` by ${report.resolvedBy.srn}` : ""}
                        </span>
                      ) : null}
                    </div>
                    {report.details ? (
                      <p
                        className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {report.details}
                      </p>
                    ) : null}
                    {report.resolutionNote ? (
                      <p className="mt-1.5 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                        Note: {report.resolutionNote}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>

              {!showResolved ? (
                <div className="px-4 py-3">
                  <ModerationForm offerId={offerId} />
                </div>
              ) : offer.deletedAt ? (
                <div className="px-4 py-3">
                  <ModerationForm offerId={offerId} restoreOnly />
                </div>
              ) : null}
            </Panel>
          );
        })}
      </div>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: "var(--text-tertiary)" }}>{label}</div>
      <div className="mt-0.5" style={{ color: "var(--text-secondary)" }}>
        {children}
      </div>
    </div>
  );
}
