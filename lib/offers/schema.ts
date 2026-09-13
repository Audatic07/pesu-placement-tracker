import { z } from "zod";

/**
 * The submission schema.
 *
 * One rule, read from two places. The server action validates a posted form
 * against it, and the form validates each field against the same shape as the
 * student types — so a CGPA of 11 is flagged the moment it is entered, with the
 * same words the server would use if it got that far. It lives apart from
 * submit.ts because that module is server-only: it reaches the database, the
 * audit log and the rate limiter, none of which a browser bundle may carry.
 *
 * The bounds carry their own messages. Zod's defaults describe the constraint
 * ("Too big: expected number to be <=10"); these describe the mistake.
 */

export const RoundInput = z.object({
  kind: z.enum([
    "PRE_PLACEMENT_TALK",
    "RESUME_SHORTLIST",
    "ONLINE_ASSESSMENT",
    "GROUP_DISCUSSION",
    "TAKE_HOME_ASSIGNMENT",
    "HACKATHON",
    "TECHNICAL_INTERVIEW",
    "SYSTEM_DESIGN",
    "MANAGERIAL",
    "HIRING_MANAGER",
    "HR",
    "OTHER",
  ]),
  mode: z.enum(["ONLINE", "IN_PERSON", "HYBRID", "UNKNOWN"]).default("UNKNOWN"),
  heldOn: z.string().optional(),
  platform: z.string().max(80).optional(),
  topics: z.string().max(300).optional(),
  difficulty: z.coerce.number().int().min(1).max(5).optional(),
  questionsAsked: z.string().max(4000).optional(),
});

export const ComponentInput = z.object({
  kind: z.enum([
    "FIXED_BASE",
    "VARIABLE_PAY",
    "JOINING_BONUS",
    "RETENTION_BONUS",
    "RELOCATION",
    "ESOP",
    "RSU",
    "GRATUITY",
    "PROVIDENT_FUND",
    "INSURANCE",
    "PERKS",
    "OTHER",
  ]),
  amountLpa: z.coerce
    .number()
    .min(0, "An amount cannot be negative.")
    .max(1000, "That is not an amount in lakhs per annum."),
  isOneTime: z.coerce.boolean().default(false),
  note: z.string().max(200).optional(),
});

/** Shared with the live validator so both sides say the same thing. */
export const BASE_ABOVE_CTC = "The fixed base is part of the CTC, so it cannot be more than it.";

export const OfferInput = z.object({
  batchYear: z.coerce.number().int().min(2000).max(9999),
  companyName: z.string().trim().min(1, "Which company?").max(160),
  roleTitle: z.string().trim().min(1, "What was the role called?").max(160),
  roleFamily: z
    .enum([
      "SDE",
      "DATA_SCIENCE",
      "DATA_ENGINEERING",
      "ANALYST",
      "QA_SDET",
      "DEVOPS_SRE",
      "EMBEDDED_HARDWARE",
      "CYBERSECURITY",
      "PRODUCT",
      "CONSULTING",
      "RESEARCH",
      "NON_TECH",
      "OTHER",
    ])
    .default("OTHER"),
  cycle: z.enum(["SUMMER_INTERNSHIP", "SIX_MONTH_INTERNSHIP", "FULL_TIME"]),
  nature: z
    .enum(["INTERNSHIP_ONLY", "FTE_ONLY", "INTERNSHIP_PLUS_FTE", "PPO_CONVERTED"])
    .default("FTE_ONLY"),

  ctcLpa: z.coerce
    .number()
    .min(0, "A CTC cannot be negative.")
    .max(1000, "That is not a CTC in lakhs per annum. 18.5 LPA is entered as 18.5.")
    .optional(),
  baseLpa: z.coerce
    .number()
    .min(0, "A base cannot be negative.")
    .max(1000, "That is not a base in lakhs per annum. 12 LPA is entered as 12.")
    .optional(),
  stipendPerMonthInr: z.coerce
    .number()
    .min(0, "A stipend cannot be negative.")
    .max(1_000_000, "That is not a monthly stipend in rupees. ₹50,000 is entered as 50000.")
    .optional(),
  components: z.array(ComponentInput).max(12).default([]),

  cgpa: z.coerce
    .number()
    .min(0, "A CGPA cannot be negative.")
    .max(10, "A CGPA is out of 10.")
    .optional(),
  backlogsAtOffer: z.coerce
    .number()
    .int("Backlogs are a whole number.")
    .min(0, "Backlogs cannot be negative.")
    .max(50, "That is more backlogs than a degree has courses.")
    .optional(),
  priorInternshipCount: z.coerce
    .number()
    .int("Internships are a whole number.")
    .min(0, "Internships cannot be negative.")
    .max(20, "That is more internships than a degree has semesters.")
    .optional(),

  locations: z.array(z.string().max(60)).max(6).default([]),
  workMode: z.enum(["ONSITE", "HYBRID", "REMOTE", "UNKNOWN"]).default("UNKNOWN"),
  bondMonths: z.coerce
    .number()
    .int("A bond is a whole number of months.")
    .min(0, "A bond cannot be negative.")
    .max(120, "A bond longer than ten years is not a bond; check the units — this is in months.")
    .optional(),
  internshipDurationMonths: z.coerce
    .number()
    .int("An internship length is a whole number of months.")
    .min(0, "A length cannot be negative.")
    .max(36, "Longer than any internship; this is in months, not weeks.")
    .optional(),

  /** What the company asked for, not what this student had. */
  announcedCgpaCutoff: z.coerce
    .number()
    .min(0, "A cutoff cannot be negative.")
    .max(10, "A CGPA cutoff is out of 10.")
    .optional(),
  eligibleBranches: z.array(z.string().max(12)).max(30).default([]),

  offerDate: z.string().optional(),
  acceptanceStatus: z.enum(["ACCEPTED", "DECLINED", "PENDING", "REVOKED"]).default("PENDING"),

  processNotes: z.string().max(8000).optional(),
  preparationResources: z.string().max(4000).optional(),
  difficultyRating: z.coerce.number().int().min(1).max(5).optional(),

  /** Default anonymous. Showing a name is an explicit, deliberate act. */
  showName: z.coerce.boolean().default(false),

  rounds: z.array(RoundInput).max(12).default([]),
}).superRefine((values, ctx) => {
  // The base is a part of the CTC, so a base above it is almost always a
  // units slip — a monthly figure, or rupees where lakhs were meant. Refused
  // rather than stored, because a stored one would put the wrong number into
  // every cash-versus-headline figure.
  if (values.baseLpa !== undefined && values.ctcLpa !== undefined && values.baseLpa > values.ctcLpa) {
    ctx.addIssue({
      code: "custom",
      path: ["baseLpa"],
      message: BASE_ABOVE_CTC,
    });
  }
});

export type OfferInputValues = z.infer<typeof OfferInput>;

export function numberOrUndefined(value: FormDataEntryValue | null): number | undefined {
  if (value === null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Decodes the submission form's wire format into validated input.
 *
 * It lives beside the schema rather than inside the server action so that
 * anything driving a submission — the form, a script, a test — goes through the
 * same decoding and not merely the same validator. The decoding is where the
 * quiet bugs live: a blank numeric field arrives as "" and must become
 * `undefined` rather than 0, an unchecked checkbox does not arrive at all, and
 * repeated fields arrive as parallel arrays that have to be zipped back into
 * objects. A fixture that skips this step cannot tell you it works.
 */
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
