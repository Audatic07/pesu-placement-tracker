import { singleParams, type SearchParams } from "@/lib/query-params";
import { formatLpa, formatCount } from "@/lib/format";
import { CYCLE_LABELS } from "@/lib/offers/labels";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentStudent } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { getCompanyTrend } from "@/lib/analytics/queries";
import { canShowName } from "@/lib/privacy/gate";
import { SummaryTable } from "@/components/data/summary-table";
import { EmptyState, PageHeader, Panel, Stat, StatGrid } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const company = await prisma.company.findUnique({ where: { slug }, select: { name: true } });
  return { title: `${company?.name ?? "Company"} · PESU Placement Tracker` };
}

export default async function CompanyPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [student, { slug }, rawQuery] = await Promise.all([getCurrentStudent(), params, searchParams]);
  const query = singleParams(rawQuery);
  const company = await prisma.company.findUnique({
    where: { slug },
    include: {
      parent: { select: { name: true, slug: true } },
      children: { select: { name: true, slug: true } },
      aliases: { select: { alias: true } },
      offers: {
        where: { deletedAt: null, verification: { not: "REMOVED" } },
        take: student ? 50 : 0,
        select: {
          id: true, roleTitle: true, cycle: true, nameVisibility: true, verification: true,
          deletedAt: true, source: true, student: { select: { name: true } },
          batch: { select: { year: true } }, compensation: { select: { ctcLpa: true } },
        },
        orderBy: [{ batch: { year: "desc" } }, { createdAt: "desc" }],
      },
    },
  });
  if (!company) notFound();
  const trend = await getCompanyTrend(company.id);
  const years = [...new Set(trend.map((row) => row.batchYear))];
  const allCtc = trend.flatMap((row) => row.highestCtc === null ? [] : [row.highestCtc]);
  const latest = trend[trend.length - 1];
  const aliases = company.aliases.map((row) => row.alias)
    .filter((alias) => alias.toLowerCase() !== company.name.toLowerCase());

  return (
    <>
      <PageHeader title={company.name} description={
        <>
          {company.parent ? <>Part of <Link href={`/companies/${company.parent.slug}`} className="underline">{company.parent.name}</Link>. </> : null}
          {aliases.length ? <>Also recorded as {aliases.join(", ")}. </> : null}
          {company.children.length ? <>Divisions: {company.children.map((child, index) => (
            <span key={child.slug}>{index ? ", " : ""}<Link href={`/companies/${child.slug}`} className="underline">{child.name}</Link></span>
          ))}.</> : null}
        </>
      } actions={<Link href={query.batch ? `/companies?batch=${query.batch}` : "/companies"} className="text-[13px] underline">All companies</Link>} />
      <div className="flex flex-col gap-5 p-6">
        <StatGrid>
          <Stat label="Seasons on record" value={formatCount(years.length)} hint={years.join(", ")} />
          <Stat label="Offers recorded" value={formatCount(trend.reduce((sum, row) => sum + row.offers, 0))} hint="Historical and student submissions" />
          <Stat label="Highest CTC" value={allCtc.length ? formatLpa(Math.max(...allCtc)) : "—"} />
          <Stat label="Most recent" value={formatLpa(latest?.highestCtc)} hint={latest ? `Batch of ${latest.batchYear}` : undefined} />
        </StatGrid>
        {trend.length ? (
          <Panel title="Year on year" description="All submissions share these aggregates. Counts represent offer outcomes, which can include multiple offers to the same person." padded={false}>
            <SummaryTable head={["Batch", "Cycle", "Offers", "Highest CTC", "Median CTC", "CGPA bar"]}
              rows={[...trend].reverse().map((row) => ({ key: row.key, cells: [
                String(row.batchYear), CYCLE_LABELS[row.cycle], formatCount(row.offers),
                formatLpa(row.highestCtc), formatLpa(row.medianCtc), row.gpaCutoff ?? "—",
              ] }))} />
          </Panel>
        ) : <Panel><EmptyState title="No offers recorded yet" description="Offers appear here as submissions are added." /></Panel>}
        {company.offers.length ? (
          <Panel title="Recent offers" description="Open a submission for its package and process notes. Historical headcounts have anonymous records." padded={false}>
            <ul>
              {company.offers.map((offer) => (
                <li key={offer.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <Link href={`/offers/${offer.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--panel-hover)]">
                    <span className="tnum text-[12px]">{offer.batch.year}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{offer.roleTitle}</span>
                      <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                        {canShowName(offer) && offer.student ? offer.student.name : "Anonymous"}
                        {` · ${CYCLE_LABELS[offer.cycle]}`}
                      </span>
                    </span>
                    <span className="tnum text-[13px]">{formatLpa(offer.compensation?.ctcLpa == null ? null : Number(offer.compensation.ctcLpa))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
