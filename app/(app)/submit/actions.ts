"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStudent } from "@/lib/auth/rbac";
import { createOffer, parseOfferForm } from "@/lib/offers/submit";
import { searchCompanies } from "@/lib/analytics/directory";

export type SubmitState = {
  error?: string;
  field?: string;
  flagged?: boolean;
};

/** Type-ahead for the company field, so free text converges on one company. */
export async function suggestCompanies(term: string) {
  await requireStudent();
  const results = await searchCompanies(term, 6);
  return results.map((company) => ({
    name: company.name,
    drives: company._count.drives,
  }));
}

export async function submitOffer(
  _previous: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const student = await requireStudent("/submit");

  const parsed = parseOfferForm(formData);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.message ?? "Check the form.", field: String(issue?.path[0] ?? "") };
  }

  const result = await createOffer(student, parsed.data);
  if (!result.ok) return { error: result.error, field: result.field };

  revalidatePath("/me");
  revalidatePath("/overview");
  redirect(`/offers/${result.offerId}?new=1`);
}
