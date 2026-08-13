import Link from "next/link";
import { requireStudent } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import {
  Button,
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
  Tag,
  formatCompactInr,
  formatCount,
  formatLpa,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Season · PESU Placement Tracker" };

/**
 * The season, in order.
 *
 * Placement season is a schedule, and no spreadsheet view of it ever answered
 * the question students actually ask — "what has already gone, and what is
 * still to come".
 *
 * Dates come from what students report: the rounds they sat, and the date the
 * offer landed. That is the only source that can still be right next year. The
 * imported spreadsheets contribute their pre-placement talk dates for the one
 * batch they cover, listed separately and marked, because a season built half
 * from a 2026 spreadsheet and half from live reports reads as one timeline and
 * is not.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const student = await requireStudent("/calendar");
  const params = await searchParams;

  const batches = await prisma.batch.findMany({ orderBy: { year: "desc" }, select: { year: true } });
  const requested = Number.parseInt(params["batch"] ?? "", 10);
  const batchYear =
    batches.find((batch) => batch.year === requested)?.year ??
    student.graduationYear ??
    batches[0]?.year ??
    new Date().getFullYear();

  const [offers, drives] = await Promise.all([
    prisma.offer.findMany({
      where: { batch: { year: batchYear }, deletedAt: null, verification: { not: "REMOVED" } },
      select: {
        id: true,
        roleTitle: true,
        cycle: true,
        tierKey: true,
        offerDate: true,
        company: { select: { id: true, name: true, slug: true } },
        compensation: { select: { id: true, ctcLpa: true, stipendPerMonthInr: true } },
        rounds: { select: { heldOn: true }, orderBy: { sequence: "asc" } },
      },
    }),
    prisma.drive.findMany({
      where: { batch: { year: batchYear }, pptDate: { not: null } },
      select: {
        id: true,
        pptDate: true,
        cycle: true,
        company: { select: { id: true, name: true, slug: true } },
        roles: {
          select: {
            title: true,
            tierKey: true,
            compensation: { select: { id: true, ctcLpa: true, stipendPerMonthInr: true } },
          },
        },
      },
      orderBy: { pptDate: "asc" },
    }),
  ]);

  // One entry per company and cycle: several classmates reporting the same
  // drive is one thing happening, not three.
  const byCompany = new Map<string, typeof offers>();
  for (const offer of offers) {
    const key = `${offer.company.id}::${offer.cycle}`;
    const bucket = byCompany.get(key);
    if (bucket) bucket.push(offer);
    else byCompany.set(key, [offer]);
  }

  const entries: SeasonEntry[] = [...byCompany.entries()].map(([key, group]) => {
    // The earliest thing anyone reported is when this company's season started.
    const stamps = group
      .flatMap((offer) => [
        ...offer.rounds.map((round) => round.heldOn),
        offer.offerDate,
      ])
      .filter((value): value is Date => value !== null);

    return {
      id: key,
      date: stamps.length ? stamps.reduce((a, b) => (a < b ? a : b)) : null,
      company: group[0]!.company,
      reports: group.length,
      roles: group.map((offer) => ({
        title: offer.roleTitle,
        tierKey: offer.tierKey,
        compensation: offer.compensation,
      })),
      imported: false,
    };
  });

  const importedEntries: SeasonEntry[] = drives.map((drive) => ({
    id: `drive-${drive.id}`,
    date: drive.pptDate,
    company: drive.company,
    reports: 0,
    roles: drive.roles.map((role) => ({
      title: role.title,
      tierKey: role.tierKey,
      compensation: role.compensation,
    })),
    imported: true,
  }));

  const dated = entries
    .filter((entry) => entry.date !== null)
    .sort((a, b) => a.date!.getTime() - b.date!.getTime());
  const undated = entries.filter((entry) => entry.date === null);

  const months = new Map<string, SeasonEntry[]>();
  for (const entry of dated) {
    const key = entry.date!.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const bucket = months.get(key);
    if (bucket) bucket.push(entry);
    else months.set(key, [entry]);
  }

  const q = `?batch=${batchYear}`;

  return (
    <>
      <PageHeader
        title="Season"
        description={`For the batch of ${batchYear}, in the order students reported it happening. ${formatCount(
          dated.length,
        )} of ${formatCount(entries.length)} companies have a date attached — dates come from the rounds people record on their own submissions.`}
        actions={
          <Button href="/submit" variant="primary">
            Add yours
          </Button>
        }
      />

      <div className="flex flex-col gap-5 p-6">
        {entries.length === 0 && importedEntries.length === 0 ? (
          <Panel>
            <EmptyState
              title="Nothing recorded for this batch yet"
              description="The season fills in as students submit offers with the dates of the rounds they sat."
              action={
                <Button href="/submit" variant="primary">
                  Add the first offer
                </Button>
              }
            />
          </Panel>
        ) : null}

        {[...months.entries()].map(([month, monthEntries]) => (
          <Panel
            key={month}
            title={month}
            description={`${formatCount(monthEntries.length)} ${
              monthEntries.length === 1 ? "company" : "companies"
            } · ${formatCount(
              monthEntries.reduce((sum, entry) => sum + entry.reports, 0),
            )} reports`}
            padded={false}
          >
            <ul>
              {monthEntries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} q={q} />
              ))}
            </ul>
          </Panel>
        ))}

        {undated.length > 0 ? (
          <Panel
            title="No date reported"
            description={`${formatCount(undated.length)} ${
              undated.length === 1 ? "company" : "companies"
            } where nobody recorded a round date or an offer date.`}
            padded={false}
          >
            <ul>
              {undated.map((entry) => (
                <EntryRow key={entry.id} entry={entry} q={q} hideDate />
              ))}
            </ul>
          </Panel>
        ) : null}

        {importedEntries.length > 0 ? (
          <Panel
            title="Imported season"
            description="Pre-placement talk dates from the placement spreadsheets. Company-level, not student-reported, and listed apart so the live timeline above stays one thing."
            padded={false}
          >
            <ul>
              {importedEntries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} q={q} />
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </>
  );
}

type SeasonEntry = {
  id: string;
  date: Date | null;
  company: { name: string; slug: string };
  reports: number;
  roles: Array<{
    title: string;
    tierKey: string | null;
    compensation: { id: string; ctcLpa: unknown; stipendPerMonthInr: unknown } | null;
  }>;
  imported: boolean;
};

function EntryRow({
  entry,
  q,
  hideDate,
}: {
  entry: SeasonEntry;
  q: string;
  hideDate?: boolean;
}) {
  const seen = new Set<string>();
  let highestCtc: number | null = null;
  let highestStipend: number | null = null;
  for (const role of entry.roles) {
    const pkg = role.compensation;
    if (!pkg || seen.has(pkg.id)) continue;
    seen.add(pkg.id);
    const ctc = pkg.ctcLpa === null ? null : Number(pkg.ctcLpa);
    if (ctc !== null && (highestCtc === null || ctc > highestCtc)) highestCtc = ctc;
    const stipend = pkg.stipendPerMonthInr === null ? null : Number(pkg.stipendPerMonthInr);
    if (stipend !== null && (highestStipend === null || stipend > highestStipend)) {
      highestStipend = stipend;
    }
  }

  return (
    <li style={{ borderBottom: "1px solid var(--line)" }}>
      <Link
        href={`/companies/${entry.company.slug}${q}`}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-(--panel-hover)"
      >
        {!hideDate ? (
          <span className="tnum w-9 shrink-0 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            {entry.date?.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
          </span>
        ) : null}

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium">{entry.company.name}</span>
            {[...new Set(entry.roles.map((role) => role.tierKey).filter(Boolean))].map((tier) => (
              <Tag key={String(tier)}>{String(tier).replace("TIER_", "T")}</Tag>
            ))}
          </span>
          <span className="block truncate text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            {[...new Set(entry.roles.map((role) => role.title).filter(Boolean))].join(", ") ||
              "Role not recorded"}
          </span>
        </span>

        <span className="hidden shrink-0 sm:block">
          {entry.imported ? (
            <StatusBadge tone="neutral">Imported</StatusBadge>
          ) : (
            <StatusBadge tone="accent">
              {formatCount(entry.reports)} {entry.reports === 1 ? "report" : "reports"}
            </StatusBadge>
          )}
        </span>

        <span className="tnum w-16 shrink-0 text-right text-[13px]">
          {highestCtc === null
            ? highestStipend
              ? formatCompactInr(highestStipend)
              : "—"
            : formatLpa(highestCtc, false)}
        </span>
      </Link>
    </li>
  );
}
