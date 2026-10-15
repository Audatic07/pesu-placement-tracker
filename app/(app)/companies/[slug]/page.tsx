import { positiveInteger, singleParams, type SearchParams } from "@/lib/query-params";
import { formatLpa, formatCount, formatCompactInr } from "@/lib/format";
import { CYCLE_LABELS } from "@/lib/offers/labels";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentStudent } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { getCompanyTrend } from "@/lib/analytics/queries";
import { historicalSourceQuote } from "@/lib/comp/source-quote";
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
  const requestedYear = positiveInteger(query.batch, 0);
  const offerPage = Math.min(100000, positiveInteger(query.page));
  const pageSize = 25;
  const company = await prisma.company.findUnique({
    where: { slug },
    include: {
      parent: { select: { name: true, slug: true } },
      children: { select: { name: true, slug: true } },
      aliases: { select: { alias: true } },
      offers: {
        where: {
          deletedAt: null, verification: { not: "REMOVED" },
          batch: { year: { ...(process.env.NODE_ENV === "production" ? { lt: 9000 } : {}), ...(requestedYear ? { equals: requestedYear } : {}) } },
        },
        take: student ? pageSize + 1 : 0,
        skip: student ? (offerPage - 1) * pageSize : 0,
        select: {
          id: true, roleTitle: true, cycle: true, nameVisibility: true, verification: true,
          nature: true, studentId: true, processNotes: true,
          deletedAt: true, source: true,
          batch: { select: { year: true } }, compensation: { select: { ctcLpa: true, rawNote: true, stipendPerMonthInr: true } },
        },
        orderBy: [{ batch: { year: "desc" } }, { createdAt: "desc" }, { id: "asc" }],
      },
    },
  });
  if (!company) notFound();
  const trend = await getCompanyTrend(company.id);
  const years = [...new Set(trend.map((row) => row.batchYear))];
  const allCtc = trend.flatMap((row) => row.highestCtc === null ? [] : [row.highestCtc]);
  const latest = trend[trend.length - 1];
  const selectedTrend = requestedYear ? trend.filter((row) => row.batchYear === requestedYear) : trend;
  const visibleOffers = company.offers.slice(0, pageSize);
  const hasNext = company.offers.length > pageSize;
  const pageHref = (page: number) => ({ pathname: `/companies/${slug}`, query: { ...(requestedYear ? { batch: String(requestedYear) } : {}), page: String(page) } });
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
          <Stat label="Highest awarded CTC" value={allCtc.length ? formatLpa(Math.max(...allCtc)) : "—"} hint="Across all seasons; excludes source quotes" />
          <Stat label="Most recent awarded CTC" value={formatLpa(latest?.highestCtc)} hint={latest ? `Batch of ${latest.batchYear}` : undefined} />
        </StatGrid>
        <form className="flex flex-wrap items-center gap-3 text-[13px]" method="get">
          <label htmlFor="company-batch">Batch</label>
          <select id="company-batch" name="batch" defaultValue={requestedYear || ""} className="rounded border border-[var(--line)] bg-[var(--panel)] px-3 py-2">
            <option value="">All seasons</option>
            {[...years].sort((a, b) => b - a).map((year) => <option key={year} value={year}>{year}</option>)}
            {requestedYear && !years.includes(requestedYear) ? <option value={requestedYear}>{requestedYear}</option> : null}
          </select>
          <button type="submit" className="rounded border border-[var(--line)] px-3 py-2">Apply</button>
        </form>
        {trend.length ? (
          <Panel title={requestedYear ? `Batch of ${requestedYear}` : "Year on year"} description="Counts are offer outcomes. Source quotes are advertised or prospective FTE figures and are excluded from awarded CTC statistics. Recorded figures are shown even for a single outcome; not reported means no awarded CTC is recorded. Recipient names stay hidden." padded={false}>
            <SummaryTable head={["Batch", "Cycle", "Offers", "Highest awarded CTC", "Median awarded CTC", "Source CTC quote (highest)", "Stipend / month", "CGPA bar"]}
              rows={[...selectedTrend].reverse().map((row) => ({ key: row.key, cells: [
                String(row.batchYear), CYCLE_LABELS[row.cycle], formatCount(row.offers),
                row.ctcWithheld ? "Withheld" : row.ctcRecords ? formatLpa(row.highestCtc) : "Not reported",
                row.ctcWithheld ? "Withheld" : row.ctcRecords ? formatLpa(row.medianCtc) : "Not reported",
                row.quoteWithheld ? "Withheld" : row.highestQuotedCtc === null ? "—" : `${formatLpa(row.highestQuotedCtc)} · quoted only`,
                row.highestStipend === null ? "—" : formatCompactInr(row.highestStipend), row.gpaCutoff ?? "—",
              ] }))} />
          </Panel>
        ) : <Panel><EmptyState title="No offers recorded yet" description="Offers appear here as submissions are added." /></Panel>}
        {student ? (
          <Panel title={requestedYear ? `Offers · ${requestedYear}` : "Recent offers"} description="Open a submission for package and process notes. Historical headcounts have anonymous records. Source quotes do not establish an awarded FTE package." padded={false}>
            <ul>
              {visibleOffers.map((offer) => {
                const quote = historicalSourceQuote(offer);
                return (
                <li key={offer.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <Link href={`/offers/${offer.id}?batch=${offer.batch.year}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--panel-hover)]">
                    <span className="tnum text-[12px]">{offer.batch.year}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{offer.roleTitle}</span>
                      <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                        Anonymous
                        {` · ${CYCLE_LABELS[offer.cycle]}`}
                      </span>
                    </span>
                    <span className="tnum text-right text-[13px]">{offer.compensation?.ctcLpa != null ? formatLpa(Number(offer.compensation.ctcLpa)) : quote?.ctcLpa != null ? `${formatLpa(quote.ctcLpa)} · source quote` : offer.compensation?.stipendPerMonthInr != null ? `${formatCompactInr(Number(offer.compensation.stipendPerMonthInr))}/mo stipend` : "Not reported"}</span>
                  </Link>
                </li>
              ); })}
            </ul>
            {!visibleOffers.length ? <p className="p-4 text-[13px]">No offers on this page for the selected batch.</p> : null}
            {offerPage > 1 || hasNext ? <nav aria-label="Offer pages" className="flex items-center justify-between p-4 text-[13px]">
              {offerPage > 1 ? <Link href={pageHref(offerPage - 1)} className="underline">Previous</Link> : <span />}
              <span>Page {offerPage}</span>
              {hasNext ? <Link href={pageHref(offerPage + 1)} className="underline">Next</Link> : <span />}
            </nav> : null}
          </Panel>
        ) : null}
      </div>
    </>
  );
}
