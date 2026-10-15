"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { AdminError } from "@/lib/admin/access";
import { parseAdminOfferForm, type AdminState } from "@/lib/admin/input";
import {
  saveAdminOffer,
  changeOfferVisibility,
  commitImport,
  importDigest,
  undoImport,
  validateImportReferences,
} from "@/lib/admin/offers";
import { decodeImport, MAX_IMPORT_BYTES } from "@/lib/admin/csv";
import { UserChange, updateUserAccess } from "@/lib/admin/users";
import {
  BatchSettings,
  createAdminBatch,
  saveBatchSettings,
} from "@/lib/admin/batches";

function failure(error: unknown): AdminState {
  if (error instanceof AdminError) return { error: error.message };
  if (error instanceof z.ZodError)
    return { error: error.issues[0]?.message ?? "Check the entered values." };
  console.error("[admin] Operation failed; transaction rolled back.");
  return {
    error:
      "The operation failed. Reload to check the current state before retrying.",
  };
}

function refresh() {
  revalidatePath("/", "layout");
}

export async function saveOffer(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const actor = await requireRole("ADMIN", "/admin/offers");
  const parsed = parseAdminOfferForm(form);
  if (!parsed.success)
    return {
      error: parsed.error.issues[0]?.message ?? "Check the entered values.",
    };
  try {
    const id = String(form.get("id") ?? "");
    const result = await saveAdminOffer(
      actor.id,
      parsed.data,
      id ? { id, updatedAt: String(form.get("updatedAt")) } : undefined,
    );
    refresh();
    return {
      success: `Saved ${result.count} outcome${result.count === 1 ? "" : "s"}.`,
      offerId: result.offerId,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function setOfferVisibility(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const actor = await requireRole("ADMIN");
  try {
    const restore = form.get("operation") === "restore";
    await changeOfferVisibility(
      actor.id,
      String(form.get("id")),
      String(form.get("updatedAt")),
      restore,
      String(form.get("reason") ?? ""),
    );
    refresh();
    return {
      success: restore
        ? "Outcome restored."
        : "Outcome removed from statistics. It can be restored here.",
    };
  } catch (error) {
    return failure(error);
  }
}

export type ImportState = AdminState & {
  digest?: string;
  csv?: string;
  rows?: Array<{
    rowId: string;
    company: string;
    batch: number;
    count: number;
    cycle: string;
    ctc: number | null;
  }>;
  outcomes?: number;
};

export async function reviewImport(
  _previous: ImportState,
  form: FormData,
): Promise<ImportState> {
  await requireRole("ADMIN", "/admin/imports");
  try {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size)
      return { error: "Choose a CSV exported from Excel or Google Sheets." };
    if (
      file.size > MAX_IMPORT_BYTES ||
      !file.name.toLowerCase().endsWith(".csv")
    )
      return { error: "Upload a UTF-8 CSV smaller than 500 KB." };
    const csv = await file.text();
    const decoded = decodeImport(csv);
    const errors = [
      ...decoded.errors,
      ...(decoded.errors.length
        ? []
        : await validateImportReferences(decoded.rows)),
    ];
    if (errors.length) return { error: errors.slice(0, 12).join("\n") };
    return {
      digest: importDigest(decoded.rows),
      csv,
      outcomes: decoded.outcomes,
      rows: decoded.rows.map((row, i) => ({
        rowId: String(i + 2),
        company: row.companyName,
        batch: row.batchYear,
        count: row.headcount,
        cycle: row.cycle,
        ctc: row.ctcLpa ?? null,
      })),
    };
  } catch (error) {
    if (error instanceof Error && !(error instanceof z.ZodError))
      return {
        error:
          error instanceof AdminError
            ? error.message
            : "The CSV could not be read. Check its size, headings and quoting against the template.",
      };
    return failure(error);
  }
}

export async function applyImport(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const actor = await requireRole("ADMIN");
  try {
    const decoded = decodeImport(String(form.get("csv") ?? ""));
    if (decoded.errors.length)
      return { error: decoded.errors.slice(0, 5).join("\n") };
    const count = await commitImport(
      actor.id,
      decoded.rows,
      String(form.get("digest") ?? ""),
    );
    refresh();
    return {
      success: `Imported ${count} outcomes. This file cannot be committed twice.`,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function removeImport(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const actor = await requireRole("ADMIN");
  try {
    const count = await undoImport(
      actor.id,
      String(form.get("digest")),
      String(form.get("reason") ?? ""),
    );
    refresh();
    return {
      success: `Removed ${count} imported outcomes. Genuine student submissions remain intact.`,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function changeUser(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const actor = await requireRole("SUPER_ADMIN", "/admin/users");
  try {
    const parsed = UserChange.parse({
      id: form.get("id"),
      updatedAt: form.get("updatedAt"),
      role: form.get("role"),
      suspended: form.get("suspended") === "on",
      reason: form.get("reason"),
    });
    await updateUserAccess(actor.id, parsed);
    refresh();
    return {
      success:
        "Account access updated. Existing sessions use the new permissions on their next request.",
    };
  } catch (error) {
    return failure(error);
  }
}

export async function addBatch(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const actor = await requireRole("ADMIN");
  try {
    await createAdminBatch(actor.id, Number(form.get("year")));
    refresh();
    return {
      success:
        "Batch created with the latest policy. Select it to review its settings.",
    };
  } catch (error) {
    return failure(error);
  }
}

export async function configureBatch(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const actor = await requireRole("ADMIN");
  try {
    const tierKeys = form.getAll("tierKey").map(String);
    const tierLabels = form.getAll("tierLabel").map(String);
    const tierRanks = form.getAll("tierRank").map(Number);
    const tierMins = form.getAll("tierMin").map(Number);
    const tierMaxes = form
      .getAll("tierMax")
      .map((value) => (String(value).trim() ? Number(value) : null));
    const tiers = tierKeys.map((key, i) => ({
      key,
      label: tierLabels[i],
      rank: tierRanks[i],
      minCtcLpa: tierMins[i],
      maxCtcLpa: tierMaxes[i],
    }));
    const parsed = BatchSettings.parse({
      year: form.get("year"),
      updatedAt: form.get("updatedAt"),
      archived: form.get("archived") === "on",
      seasonStartsAt: form.get("seasonStartsAt") || undefined,
      seasonEndsAt: form.get("seasonEndsAt") || undefined,
      maxSummerInternships: form.get("maxSummerInternships"),
      maxSixMonthInternships: form.get("maxSixMonthInternships"),
      maxFullTimePerTier: form.get("maxFullTimePerTier"),
      maxFullTimeTotal: form.get("maxFullTimeTotal"),
      closeLowerTiers: form.get("closeLowerTiers") === "on",
      description: form.get("description") || "",
      reason: form.get("reason"),
      tiers,
    });
    await saveBatchSettings(actor.id, parsed);
    refresh();
    return {
      success:
        "Batch settings saved. Existing outcomes keep their recorded tiers.",
    };
  } catch (error) {
    return failure(error);
  }
}

export async function diagnoseServices(
  _previous: AdminState,
  _form: FormData,
): Promise<AdminState> {
  await requireRole("ADMIN");
  const { checkServices } = await import("@/lib/admin/diagnostics");
  return { success: await checkServices() };
}
