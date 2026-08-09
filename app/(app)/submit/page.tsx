import { requireStudent } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { getQuotaState } from "@/lib/policy/quota";
import { ensureBatch } from "@/lib/policy/batch";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { OfferForm } from "./offer-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add an offer · PESU Placement Tracker" };

export default async function SubmitPage() {
  const student = await requireStudent("/submit");

  if (!student.graduationYear) {
    return (
      <>
        <PageHeader title="Add an offer" />
        <div className="p-6">
          <Panel>
            <EmptyState
              title="We could not work out your graduating batch"
              description="An offer has to belong to a batch, and yours could not be derived from your SRN or semester. An admin can set it on your profile."
            />
          </Panel>
        </div>
      </>
    );
  }

  await ensureBatch(student.graduationYear);
  const quota = await getQuotaState(student.id, student.graduationYear);

  if (!quota) {
    return (
      <>
        <PageHeader title="Add an offer" />
        <div className="p-6">
          <Panel>
            <EmptyState
              title="This batch has no submission policy yet"
              description="An admin needs to configure how many offers a student may record before submissions can open."
            />
          </Panel>
        </div>
      </>
    );
  }

  // Seeded into a datalist so free text converges on companies that already
  // exist, rather than creating a fifth spelling of one that does.
  const [companies, branches] = await Promise.all([
    prisma.company.findMany({
      select: { name: true },
      orderBy: { name: "asc" },
      take: 600,
    }),
    prisma.branch.findMany({
      where: { isActive: true },
      select: { code: true, name: true },
      orderBy: { rank: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Add an offer"
        description={`Recording yours is what makes the per-student figures possible for the batch of ${quota.batchYear} — CGPA against package, how many rounds a company really runs, what the process was actually like.`}
      />
      <div className="max-w-4xl p-6">
        <OfferForm
          quota={quota}
          companySuggestions={companies.map((company) => company.name)}
          branches={branches}
        />
      </div>
    </>
  );
}
