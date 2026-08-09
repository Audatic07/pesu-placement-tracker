"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudent } from "@/lib/auth/rbac";
import { fileReport } from "@/lib/moderation/reports";

export type ReportState = { ok?: boolean; error?: string };

const Input = z.object({
  offerId: z.string().min(1),
  reason: z.enum([
    "INFLATED_CTC",
    "FAKE_OFFER",
    "WRONG_COMPANY",
    "DUPLICATE",
    "PRIVACY_VIOLATION",
    "ABUSE",
    "OTHER",
  ]),
  details: z.string().max(2000).optional(),
});

export async function reportOffer(
  _previous: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const student = await requireStudent();

  const parsed = Input.safeParse({
    offerId: formData.get("offerId"),
    reason: formData.get("reason"),
    details: formData.get("details") || undefined,
  });
  if (!parsed.success) return { error: "Pick a reason." };

  const result = await fileReport(
    student,
    parsed.data.offerId,
    parsed.data.reason,
    parsed.data.details ?? null,
  );
  if (!result.ok) return { error: result.error };

  revalidatePath(`/offers/${parsed.data.offerId}`);
  return { ok: true };
}
