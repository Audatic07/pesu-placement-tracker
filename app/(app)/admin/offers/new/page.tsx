import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/ui/primitives";
import { OfferEditor } from "../offer-editor";
import {
  positiveInteger,
  singleParams,
  type SearchParams,
} from "@/lib/query-params";

export default async function NewOfferPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("ADMIN");
  const params = singleParams(await searchParams);
  const [batches, branches] = await Promise.all([
    prisma.batch.findMany({
      orderBy: { year: "desc" },
      select: { year: true },
    }),
    prisma.branch.findMany({
      select: { code: true },
      orderBy: { rank: "asc" },
    }),
  ]);
  const year = positiveInteger(params.batch, batches[0]?.year ?? 2026);
  return (
    <>
      <PageHeader
        title="Add placement outcomes"
        description="Anonymous administrative entry for any batch, independent of your personal submission quota."
      />
      <div className="max-w-4xl p-6">
        <OfferEditor
          batches={batches.map((batch) => batch.year)}
          branches={branches.map((branch) => branch.code)}
          initial={{ batchYear: year }}
        />
      </div>
    </>
  );
}
