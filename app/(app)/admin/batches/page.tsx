import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/rbac";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { TextInput, TextArea, Checkbox } from "@/components/forms/fields";
import { singleParams, type SearchParams } from "@/lib/query-params";
import { AdminForm } from "../admin-form";
import { addBatch, configureBatch } from "../actions";

export default async function BatchesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("ADMIN");
  const params = singleParams(await searchParams);
  const batches = await prisma.batch.findMany({
    orderBy: { year: "desc" },
    include: {
      tierConfigs: { orderBy: { rank: "asc" } },
      submissionRule: true,
    },
  });
  const batch =
    batches.find((candidate) => candidate.year === Number(params.batch)) ??
    batches[0];
  return (
    <>
      <PageHeader
        title="Batch settings"
        description="Create seasons, maintain submission policies, and freeze student entry for completed batches. Admin corrections remain available."
      />
      <div className="max-w-4xl space-y-6 p-6">
        <Panel title="New graduating batch">
          <div className="p-4">
            <AdminForm action={addBatch} label="Create batch">
              <TextInput
                label="Graduating year"
                name="year"
                type="number"
                min={2000}
                max={9999}
                required
              />
            </AdminForm>
          </div>
        </Panel>
        {batch ? (
          <Panel title={`Batch ${batch.year}`}>
            <div className="p-4">
              <AdminForm
                key={`${batch.id}:${batch.updatedAt.toISOString()}`}
                action={configureBatch}
              >
                <input type="hidden" name="year" value={batch.year} />
                <input
                  type="hidden"
                  name="updatedAt"
                  value={batch.updatedAt.toISOString()}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextInput
                    label="Season start"
                    name="seasonStartsAt"
                    type="date"
                    defaultValue={batch.seasonStartsAt
                      ?.toISOString()
                      .slice(0, 10)}
                  />
                  <TextInput
                    label="Season end"
                    name="seasonEndsAt"
                    type="date"
                    defaultValue={batch.seasonEndsAt
                      ?.toISOString()
                      .slice(0, 10)}
                  />
                  {[
                    ["maxSummerInternships", "Summer internships", 1],
                    ["maxSixMonthInternships", "Six-month internships", 3],
                    ["maxFullTimePerTier", "Full-time offers per tier", 1],
                    ["maxFullTimeTotal", "Full-time offers total", 3],
                  ].map(([key, label, fallback]) => (
                    <TextInput
                      key={key}
                      label={String(label)}
                      name={String(key)}
                      type="number"
                      min={0}
                      max={20}
                      required
                      defaultValue={
                        batch.submissionRule?.[key as "maxSummerInternships"] ??
                        Number(fallback)
                      }
                    />
                  ))}
                </div>
                <Checkbox
                  name="closeLowerTiers"
                  label="A higher-tier offer closes lower tiers"
                  defaultChecked={batch.submissionRule?.closeLowerTiers ?? true}
                />
                <Checkbox
                  name="archived"
                  label="Archive this batch"
                  defaultChecked={batch.isArchived}
                  hint="Stops student submissions. Admins can still correct the historical record."
                />
                <TextArea
                  label="Policy shown to students"
                  name="description"
                  defaultValue={batch.submissionRule?.description ?? ""}
                />
                <fieldset className="space-y-3">
                  <legend className="text-[13px] font-medium">
                    Tier boundaries
                  </legend>
                  <p
                    className="text-[12px]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Rank 1 is highest. Minimum is inclusive, maximum exclusive;
                    blank maximum means unbounded. Existing offers retain their
                    recorded tier.
                  </p>
                  {batch.tierConfigs.map((tier) => (
                    <div key={tier.id} className="grid gap-3 sm:grid-cols-4">
                      <input type="hidden" name="tierKey" value={tier.key} />
                      <TextInput
                        label={`${tier.key} label`}
                        name="tierLabel"
                        defaultValue={tier.label}
                        required
                        maxLength={60}
                      />
                      <TextInput
                        label="Rank"
                        name="tierRank"
                        type="number"
                        min={1}
                        max={20}
                        defaultValue={tier.rank}
                        required
                      />
                      <TextInput
                        label="Minimum CTC (LPA)"
                        name="tierMin"
                        type="number"
                        min={0}
                        max={1000}
                        step="0.01"
                        defaultValue={Number(tier.minCtcLpa)}
                        required
                      />
                      <TextInput
                        label="Maximum CTC (LPA)"
                        name="tierMax"
                        type="number"
                        min={0}
                        max={1000}
                        step="0.01"
                        defaultValue={
                          tier.maxCtcLpa === null
                            ? undefined
                            : Number(tier.maxCtcLpa)
                        }
                      />
                    </div>
                  ))}
                </fieldset>
                <TextInput
                  label="Reason for this change"
                  name="reason"
                  minLength={5}
                  maxLength={500}
                  required
                />
              </AdminForm>
            </div>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
