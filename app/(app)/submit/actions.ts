"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStudent } from "@/lib/auth/rbac";
import { createOffer } from "@/lib/offers/submit";
import { parseOfferForm } from "@/lib/offers/schema";

export type SubmitState = {
  error?: string;
  field?: string;
};

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

  // Every page that shows offers, not only the two closest: the sidebar keeps
  // prefetched copies of these, and the one figure a student is waiting to see
  // after filing is their own.
  for (const path of ["/me", "/overview", "/companies", "/calendar", "/analysis"]) {
    revalidatePath(path);
  }
  redirect(`/offers/${result.offerId}?new=1`);
}
