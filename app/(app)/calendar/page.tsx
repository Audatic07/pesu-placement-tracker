import { getBatchYears } from "@/lib/analytics/batches";
import { resolveBatchYear, singleParams, type SearchParams } from "@/lib/query-params";
import { formatLpa, formatCompactInr, formatCount } from "@/lib/format";
import Link from "next/link";
import { getCurrentStudent } from "@/lib/auth/rbac";
import { getSeasonEntries, type SeasonEntry } from "@/lib/analytics/queries";
import {
  Button,
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
  Tag,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Season · PESU Placement Tracker" };
const monthFormatter = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const dayFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const student = await getCurrentStudent();
  const params = singleParams(await searchParams);

  const years = await getBatchYears();
  const batchYear = resolveBatchYear(params["batch"], years, student?.graduationYear ?? null);

  const entries = await getSeasonEntries(batchYear);

  const dated = entries
    .filter((entry) => entry.date !== null)
    .sort((a, b) => a.date! - b.date!);
  const undated = entries.filter((entry) => entry.date === null);

  const months = new Map<string, SeasonEntry[]>();
  for (const entry of dated) {
    const key = monthFormatter.format(entry.date!);
    const bucket = months.get(key);
    if (bucket) bucket.push(entry);
    else months.set(key, [entry]);
  }

  const q = `?batch=${batchYear}`;

  return (
    <>
      <PageHeader
        title="Season"
        description={`For the batch of ${batchYear}, using recorded offer and round dates. ${formatCount(
          dated.length,
        )} of ${formatCount(entries.length)} recruiting entries have an exact date. Historical and student submissions share this timeline.`}
        actions={
          <Button href="/submit" variant="primary">
            Add yours
          </Button>
        }
      />

      <div className="flex flex-col gap-5 p-6">
        {entries.length === 0 ? (
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
             )} offers`}
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
            title="No exact date recorded"
            description={`${formatCount(undated.length)} ${
              undated.length === 1 ? "company" : "companies"
            } with no exact round or offer date; month-only and conflicting schedules remain in the source notes.`}
            padded={false}
          >
            <ul>
              {undated.map((entry) => (
                <EntryRow key={entry.id} entry={entry} q={q} hideDate />
              ))}
            </ul>
          </Panel>
        ) : null}


      </div>
    </>
  );
}

function EntryRow({
  entry,
  q,
  hideDate,
}: {
  entry: SeasonEntry;
  q: string;
  hideDate?: boolean;
}) {
  const { highestCtc, highestStipend } = entry;

  return (
    <li style={{ borderBottom: "1px solid var(--line)" }}>
      <Link
        href={`/companies/${entry.company.slug}${q}`}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--panel-hover)]"
      >
        {!hideDate ? (
          <span className="tnum w-9 shrink-0 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            {entry.date ? dayFormatter.format(entry.date) : ""}
          </span>
        ) : null}

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium">{entry.company.name}</span>
            {entry.tierKeys.map((tier) => (
              <Tag key={String(tier)}>{String(tier).replace("TIER_", "T")}</Tag>
            ))}
          </span>
          <span className="block truncate text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            {entry.roleTitles.join(", ") ||
              "Role not recorded"}
          </span>
        </span>

        <span className="hidden shrink-0 sm:block">
          <StatusBadge tone="accent">
            {formatCount(entry.reports)} {entry.reports === 1 ? "offer" : "offers"}
          </StatusBadge>
        </span>

        <span className="tnum w-16 shrink-0 text-right text-[13px]">
          {highestCtc === null
            ? highestStipend !== null
              ? formatCompactInr(highestStipend)
              : "—"
            : formatLpa(highestCtc, false)}
        </span>
      </Link>
    </li>
  );
}
