import { z } from "zod";
import {
  ComponentInput,
  OfferInput,
  numberOrUndefined,
} from "@/lib/offers/schema";

const optionalNumber = z.preprocess(
  (value) =>
    value === "" || value === null || value === undefined ? undefined : value,
  z.coerce.number().finite().nonnegative().max(1000).optional(),
);

// Administrative entry has no student identity or personal quota. Counts are
// anonymous outcomes, never evidence of distinct students across employers.
export const AdminOfferInput = z
  .object({
    batchYear: z.coerce.number().int().min(2000).max(9999),
    companyName: z.string().trim().min(1).max(160),
    roleTitle: z.string().trim().min(1).max(160),
    cycle: OfferInput.shape.cycle,
    nature: OfferInput.shape.nature,
    roleFamily: OfferInput.shape.roleFamily,
    workMode: OfferInput.shape.workMode,
    acceptanceStatus: z
      .enum(["UNKNOWN", "ACCEPTED", "DECLINED", "PENDING", "REVOKED"])
      .default("UNKNOWN"),
    ctcLpa: optionalNumber,
    baseLpa: optionalNumber,
    stipendPerMonthInr: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce.number().finite().min(0).max(1_000_000).optional(),
    ),
    headcount: z.coerce.number().int().min(1).max(100).default(1),
    branchCode: z.string().trim().toUpperCase().max(12).default(""),
    offerDate: z.iso.date().optional(),
    locations: z.array(z.string().trim().min(1).max(60)).max(6).default([]),
    announcedCgpaCutoff: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce.number().finite().min(0).max(10).optional(),
    ),
    bondMonths: OfferInput.shape.bondMonths,
    internshipDurationMonths: OfferInput.shape.internshipDurationMonths,
    eligibleBranches: OfferInput.shape.eligibleBranches,
    processNotes: z.string().max(8000).default(""),
    // An absent component list preserves an existing package on edit. Empty []
    // explicitly clears it. New entries use INR amounts in LPA.
    components: z.array(ComponentInput).max(12).optional(),
    reason: z
      .string()
      .trim()
      .min(5, "Include a source or reason (at least 5 characters).")
      .max(500),
  })
  .superRefine((value, context) => {
    if (
      value.baseLpa !== undefined &&
      value.ctcLpa !== undefined &&
      value.baseLpa > value.ctcLpa
    ) {
      context.addIssue({
        code: "custom",
        path: ["baseLpa"],
        message: "Fixed base cannot exceed CTC.",
      });
    }
    if (value.cycle === "FULL_TIME" && value.nature === "INTERNSHIP_ONLY") {
      context.addIssue({
        code: "custom",
        path: ["nature"],
        message: "A full-time outcome cannot be internship-only.",
      });
    }
    if (
      value.nature === "INTERNSHIP_ONLY" &&
      (value.ctcLpa !== undefined || value.baseLpa !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["ctcLpa"],
        message:
          "For internship-only outcomes, leave FTE amounts blank. Put a conditional FTE package in notes.",
      });
    }
  });

export type AdminOfferValues = z.infer<typeof AdminOfferInput>;
export type AdminState = { error?: string; success?: string; offerId?: string };

export function parseAdminOfferForm(form: FormData) {
  const componentText = String(form.get("componentsJson") ?? "").trim();
  let components: unknown;
  try {
    components = componentText ? JSON.parse(componentText) : undefined;
  } catch {
    return {
      success: false as const,
      error: {
        issues: [{ message: "Compensation components must be a JSON array." }],
      },
    };
  }
  const list = (key: string) =>
    String(form.get(key) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return AdminOfferInput.safeParse({
    batchYear: form.get("batchYear"),
    companyName: form.get("companyName"),
    roleTitle: form.get("roleTitle"),
    cycle: form.get("cycle"),
    nature: form.get("nature") || "FTE_ONLY",
    roleFamily: form.get("roleFamily") || "OTHER",
    workMode: form.get("workMode") || "UNKNOWN",
    acceptanceStatus: form.get("acceptanceStatus") || "UNKNOWN",
    headcount: form.get("headcount") || 1,
    branchCode: form.get("branchCode") || "",
    ctcLpa: numberOrUndefined(form.get("ctcLpa")),
    baseLpa: numberOrUndefined(form.get("baseLpa")),
    stipendPerMonthInr: numberOrUndefined(form.get("stipendPerMonthInr")),
    announcedCgpaCutoff: numberOrUndefined(form.get("announcedCgpaCutoff")),
    bondMonths: numberOrUndefined(form.get("bondMonths")),
    internshipDurationMonths: numberOrUndefined(
      form.get("internshipDurationMonths"),
    ),
    eligibleBranches: list("eligibleBranches"),
    locations: list("locations"),
    offerDate: form.get("offerDate") || undefined,
    processNotes: form.get("processNotes") || "",
    reason: form.get("reason"),
    components,
  });
}
