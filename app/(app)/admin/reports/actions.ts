"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { resolveReports, restoreOffer } from "@/lib/moderation/reports";

export type ModerationState = { ok?: boolean; error?: string };

const Input = z.object({
  offerId: z.string().min(1),
  action: z.enum(["KEEP", "REMOVE", "VERIFY", "RESTORE"]),
  note: z.string().max(2000).optional(),
});

export async function moderate(
  _previous: ModerationState,
  formData: FormData,
): Promise<ModerationState> {
  const admin = await requireRole("ADMIN");

  const parsed = Input.safeParse({
    offerId: formData.get("offerId"),
    action: formData.get("action"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: "Could not read that decision." };

  const result =
    parsed.data.action === "RESTORE"
      ? await restoreOffer(admin, parsed.data.offerId)
      : await resolveReports(admin, parsed.data.offerId, parsed.data.action, parsed.data.note ?? null);

  if (!result.ok) return { error: result.error };

  revalidatePath("/admin/reports");
  revalidatePath(`/offers/${parsed.data.offerId}`);
  return { ok: true };
}
