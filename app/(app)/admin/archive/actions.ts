"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/rbac";
import { AdminError } from "@/lib/admin/access";
import type { AdminState } from "@/lib/admin/input";
import { loadPlacementArchive } from "@/lib/admin/archive";
import {
  archiveSummary,
  decodePlacementArchive,
  MAX_ARCHIVE_BYTES,
} from "@/lib/admin/archive-schema";

export type ArchiveState = AdminState & {
  summary?: ReturnType<typeof archiveSummary>;
};

export async function reviewArchive(
  _previous: ArchiveState,
  form: FormData,
): Promise<ArchiveState> {
  await requireRole("SUPER_ADMIN", "/admin/archive");
  const file = form.get("file");
  if (
    !(file instanceof File) ||
    !file.size ||
    file.size > MAX_ARCHIVE_BYTES ||
    !file.name.toLowerCase().endsWith(".json.gz")
  )
    return {
      error: "Choose a placement archive (.json.gz) smaller than 500 KB.",
    };
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const data = decodePlacementArchive(bytes);
    return { summary: archiveSummary(data) };
  } catch {
    return {
      error:
        "The archive is invalid. Check its format, manifest, linked IDs and anonymous outcomes. Nothing was imported.",
    };
  }
}

export async function applyArchive(
  _previous: AdminState,
  form: FormData,
): Promise<AdminState> {
  const actor = await requireRole("SUPER_ADMIN", "/admin/archive");
  const file = form.get("file");
  const digest = form.get("digest");
  if (
    !(file instanceof File) ||
    !file.size ||
    file.size > MAX_ARCHIVE_BYTES ||
    typeof digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(digest)
  )
    return { error: "Review a valid archive before importing it." };
  let data;
  try {
    data = decodePlacementArchive(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return {
      error:
        "The reviewed archive is invalid. Review it again. Nothing was imported.",
    };
  }
  try {
    const result = await loadPlacementArchive(actor.id, data, digest);
    revalidatePath("/", "layout");
    return {
      success: result.alreadyImported
        ? "This archive is already imported. No duplicate outcomes were added."
        : `Imported ${result.outcomes.toLocaleString("en-IN")} outcomes, ${result.components.toLocaleString("en-IN")} compensation components and ${result.rounds.toLocaleString("en-IN")} recruiting rounds. ${result.yielded} anonymous outcomes yielded to existing student submissions.`,
    };
  } catch (error) {
    if (error instanceof AdminError) return { error: error.message };
    console.error("[admin] Archive import failed; transaction rolled back.");
    return {
      error:
        "The import failed. Check the audit log before retrying; a completed archive cannot create duplicates.",
    };
  }
}
