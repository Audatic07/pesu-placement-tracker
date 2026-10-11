import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/rbac";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { TextInput } from "@/components/forms/fields";
import { AdminForm } from "../../admin-form";
import { setOfferVisibility } from "../../actions";
import { OfferEditor } from "../offer-editor";

export default async function EditOfferPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("ADMIN");
  const { id } = await params;
  const [offer, batches, branches] = await Promise.all([
    prisma.offer.findUnique({
      where: { id },
      include: {
        company: true,
        batch: true,
        branch: true,
        compensation: { include: { components: true } },
        revisions: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    }),
    prisma.batch.findMany({
      select: { year: true },
      orderBy: { year: "desc" },
    }),
    prisma.branch.findMany({
      select: { code: true },
      orderBy: { rank: "asc" },
    }),
  ]);
  if (!offer) notFound();
  const number = (value: { toString(): string } | null | undefined) =>
    value == null ? undefined : Number(value);
  return (
    <>
      <PageHeader
        title={offer.company.name}
        description={`${offer.roleTitle} · ${offer.batch.year} · ${offer.source === "SELF_REPORTED" ? "Student submission" : "Anonymous administrative outcome"}`}
      />
      <div className="max-w-4xl space-y-6 p-6">
        {offer.yieldedToId ? (
          <p className="text-[13px]">
            This historical outcome is represented by a student's own
            submission.{" "}
            <Link
              prefetch={false}
              className="underline"
              href={`/admin/offers/${offer.yieldedToId}`}
            >
              Manage that outcome
            </Link>
            .
          </p>
        ) : (
          <>
            {!offer.deletedAt ? (
              <OfferEditor
                batches={batches.map((batch) => batch.year)}
                branches={branches.map((branch) => branch.code)}
                edit={{
                  id: offer.id,
                  updatedAt: offer.updatedAt.toISOString(),
                }}
                initial={{
                  batchYear: offer.batch.year,
                  companyName: offer.company.name,
                  roleTitle: offer.roleTitle,
                  cycle: offer.cycle,
                  nature: offer.nature,
                  roleFamily: offer.roleFamily,
                  branchCode: offer.branch?.code ?? "",
                  ctcLpa: number(offer.compensation?.ctcLpa),
                  baseLpa: number(offer.compensation?.baseLpa),
                  stipendPerMonthInr: number(
                    offer.compensation?.stipendPerMonthInr,
                  ),
                  locations: offer.locations,
                  workMode: offer.workMode,
                  acceptanceStatus: offer.acceptanceStatus,
                  offerDate: offer.offerDate?.toISOString().slice(0, 10),
                  announcedCgpaCutoff: number(offer.announcedCgpaCutoff),
                  eligibleBranches: offer.eligibleBranches,
                  bondMonths: offer.bondMonths ?? undefined,
                  internshipDurationMonths:
                    offer.internshipDurationMonths ?? undefined,
                  processNotes: offer.processNotes ?? "",
                }}
              />
            ) : (
              <p className="text-[13px]">
                Removed: {offer.deletedReason}. Restore this outcome before
                editing.
              </p>
            )}
            <Panel
              title={
                offer.deletedAt ? "Restore outcome" : "Remove from statistics"
              }
            >
              <div className="p-4">
                <AdminForm
                  key={offer.updatedAt.toISOString()}
                  action={setOfferVisibility}
                  label={offer.deletedAt ? "Restore outcome" : "Remove outcome"}
                >
                  <input type="hidden" name="id" value={offer.id} />
                  <input
                    type="hidden"
                    name="updatedAt"
                    value={offer.updatedAt.toISOString()}
                  />
                  <input
                    type="hidden"
                    name="operation"
                    value={offer.deletedAt ? "restore" : "remove"}
                  />
                  <TextInput
                    label="Reason"
                    name="reason"
                    minLength={5}
                    maxLength={500}
                    required
                    hint="The outcome and its history stay in the database."
                  />
                </AdminForm>
              </div>
            </Panel>
          </>
        )}
        {offer.compensation?.components.length ? (
          <details className="text-[12px]">
            <summary>Current compensation components</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(offer.compensation.components, null, 2)}
            </pre>
          </details>
        ) : null}
        <Panel title="Edit history">
          <div className="space-y-3 p-4 text-[13px]">
            {offer.revisions.length ? (
              offer.revisions.map((revision) => (
                <details key={revision.id}>
                  <summary className="cursor-pointer">
                    {revision.createdAt
                      .toISOString()
                      .slice(0, 16)
                      .replace("T", " ")}{" "}
                    UTC · {revision.reason}
                  </summary>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-[12px]">
                    {JSON.stringify(revision.snapshot, null, 2)}
                  </pre>
                </details>
              ))
            ) : (
              <p>No edits recorded.</p>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
