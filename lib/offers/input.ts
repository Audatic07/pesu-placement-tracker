import { z } from "zod";
import {
  AcceptanceStatus, CompensationComponentKind, OfferCycle, OfferNature,
  RoleFamily, RoundKind, RoundMode, WorkMode,
} from "@/generated/prisma/enums";

export const RoundInput = z.object({
  kind: z.enum(RoundKind),
  mode: z.enum(RoundMode).default("UNKNOWN"),
  heldOn: z.iso.date().optional(),
  platform: z.string().max(80).optional(),
  topics: z.string().max(300).optional(),
  difficulty: z.coerce.number().int().min(1).max(5).optional(),
  questionsAsked: z.string().max(4000).optional(),
});

export const ComponentInput = z.object({
  kind: z.enum(CompensationComponentKind),
  amountLpa: z.coerce.number().min(0).max(1000),
  isOneTime: z.boolean().default(false),
  note: z.string().max(200).optional(),
});

export const OfferInput = z.object({
  batchYear: z.coerce.number().int().min(2000).max(9999),
  companyName: z.string().trim().min(1, "Which company?").max(160),
  roleTitle: z.string().trim().min(1, "What was the role called?").max(160),
  roleFamily: z.enum(RoleFamily).default("OTHER"),
  cycle: z.enum(OfferCycle),
  nature: z.enum(OfferNature).default("FTE_ONLY"),

  ctcLpa: z.coerce.number().min(0).max(1000).optional(),
  baseLpa: z.coerce.number().min(0).max(1000).optional(),
  stipendPerMonthInr: z.coerce.number().min(0).max(1_000_000).optional(),
  components: z.array(ComponentInput).max(12).default([]),

  cgpa: z.coerce.number().min(0).max(10).optional(),
  backlogsAtOffer: z.coerce.number().int().min(0).max(50).optional(),
  priorInternshipCount: z.coerce.number().int().min(0).max(20).optional(),

  locations: z.array(z.string().max(60)).max(6).default([]),
  workMode: z.enum(WorkMode).default("UNKNOWN"),
  bondMonths: z.coerce.number().int().min(0).max(120).optional(),
  internshipDurationMonths: z.coerce.number().int().min(0).max(36).optional(),

  /** What the company asked for, not what this student had. */
  announcedCgpaCutoff: z.coerce.number().min(0).max(10).optional(),
  eligibleBranches: z.array(z.string().max(12)).max(30).default([]),

  offerDate: z.iso.date().optional(),
  acceptanceStatus: z.enum(AcceptanceStatus).default("PENDING"),

  processNotes: z.string().max(8000).optional(),
  preparationResources: z.string().max(4000).optional(),
  difficultyRating: z.coerce.number().int().min(1).max(5).optional(),

  /** Default anonymous. Showing a name is an explicit, deliberate act. */
  showName: z.boolean().default(false),

  rounds: z.array(RoundInput).max(12).default([]),
});

export type OfferInputValues = z.infer<typeof OfferInput>;

function numberOrUndefined(value: FormDataEntryValue | null): number | undefined {
  if (value === null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  return Number(text);
}

/** Blank numbers stay absent; repeated form fields are zipped by row index. */
export function parseOfferForm(formData: FormData) {
  const componentKinds = formData.getAll("componentKind").map(String);
  const componentAmounts = formData.getAll("componentAmount").map(String);
  const componentOneTime = formData.getAll("componentOneTime").map(String);

  const components = componentKinds
    .map((kind, index) => ({
      kind,
      amountLpa: componentAmounts[index] ?? "",
      isOneTime: componentOneTime[index] === "true",
    }))
    .filter((component) => component.kind && component.amountLpa !== "");

  const roundKinds = formData.getAll("roundKind").map(String);
  const roundModes = formData.getAll("roundMode").map(String);
  const roundDifficulty = formData.getAll("roundDifficulty").map(String);
  const roundTopics = formData.getAll("roundTopics").map(String);
  const roundHeldOn = formData.getAll("roundHeldOn").map(String);

  const rounds = roundKinds
    .map((kind, index) => ({
      kind,
      mode: roundModes[index] || "UNKNOWN",
      difficulty: roundDifficulty[index] || undefined,
      topics: roundTopics[index] || undefined,
      heldOn: roundHeldOn[index] || undefined,
    }))
    .filter((round) => round.kind);

  return OfferInput.safeParse({
    batchYear: formData.get("batchYear"),
    companyName: formData.get("companyName"),
    roleTitle: formData.get("roleTitle"),
    roleFamily: formData.get("roleFamily") || "OTHER",
    cycle: formData.get("cycle"),
    nature: formData.get("nature") || "FTE_ONLY",
    ctcLpa: numberOrUndefined(formData.get("ctcLpa")),
    baseLpa: numberOrUndefined(formData.get("baseLpa")),
    stipendPerMonthInr: numberOrUndefined(formData.get("stipendPerMonthInr")),
    components,
    cgpa: numberOrUndefined(formData.get("cgpa")),
    backlogsAtOffer: numberOrUndefined(formData.get("backlogsAtOffer")),
    priorInternshipCount: numberOrUndefined(formData.get("priorInternshipCount")),
    locations: String(formData.get("locations") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 6),
    workMode: formData.get("workMode") || "UNKNOWN",
    bondMonths: numberOrUndefined(formData.get("bondMonths")),
    internshipDurationMonths: numberOrUndefined(formData.get("internshipDurationMonths")),
    announcedCgpaCutoff: numberOrUndefined(formData.get("announcedCgpaCutoff")),
    eligibleBranches: formData.getAll("eligibleBranches").map(String).filter(Boolean),
    offerDate: formData.get("offerDate") || undefined,
    acceptanceStatus: formData.get("acceptanceStatus") || "PENDING",
    processNotes: formData.get("processNotes") || undefined,
    preparationResources: formData.get("preparationResources") || undefined,
    difficultyRating: numberOrUndefined(formData.get("difficultyRating")),
    showName: formData.get("showName") === "on",
    rounds,
  });
}
