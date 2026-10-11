import { BASE_ABOVE_CTC, ComponentInput, OfferInput, numberOrUndefined } from "./schema";

/**
 * Live validation for the submission form.
 *
 * The form's inputs used to be checked only when the whole thing was posted,
 * so a CGPA of 11 typed in the second section was pointed out after the last
 * one. This checks one field at a time, as it is typed, against the same
 * schema the server action validates the posted form with. The browser bundle
 * carries the schema and nothing else from the submission path: no database,
 * no audit log, no quota — those stay behind `server-only`, and the server is
 * still the rule. A field this file passes can still be refused on submit; a
 * field it flags would have been refused anyway, now sooner.
 *
 * Errors are keyed by the control's name, with the row index appended for the
 * repeated component and round fields ("componentAmount:1"), which is how the
 * form addresses them.
 */

export type FieldErrors = Record<string, string>;

const shape = OfferInput.shape;

/** Fields posted once, validated against their own slice of the schema. */
const SCALAR = {
  companyName: shape.companyName,
  roleTitle: shape.roleTitle,
  ctcLpa: shape.ctcLpa,
  baseLpa: shape.baseLpa,
  stipendPerMonthInr: shape.stipendPerMonthInr,
  cgpa: shape.cgpa,
  backlogsAtOffer: shape.backlogsAtOffer,
  priorInternshipCount: shape.priorInternshipCount,
  bondMonths: shape.bondMonths,
  internshipDurationMonths: shape.internshipDurationMonths,
  announcedCgpaCutoff: shape.announcedCgpaCutoff,
  processNotes: shape.processNotes,
  preparationResources: shape.preparationResources,
} as const;

/** Fields posted once per row. */
const REPEATED = {
  componentAmount: ComponentInput.shape.amountLpa,
} as const;

const NUMERIC = new Set([
  "ctcLpa",
  "baseLpa",
  "stipendPerMonthInr",
  "cgpa",
  "backlogsAtOffer",
  "priorInternshipCount",
  "bondMonths",
  "internshipDurationMonths",
  "announcedCgpaCutoff",
  "componentAmount",
]);

type Name = keyof typeof SCALAR | keyof typeof REPEATED;

export function isValidatedField(name: string): name is Name {
  return name in SCALAR || name in REPEATED;
}

/**
 * The error for one field's current text, or null. `siblings` supplies the
 * other fields a rule depends on — today only the CTC, for the base.
 */
export function validateField(
  name: Name,
  raw: string,
  siblings: { ctcLpa?: string } = {},
): string | null {
  const schema = name in SCALAR ? SCALAR[name as keyof typeof SCALAR] : REPEATED[name as keyof typeof REPEATED];

  // The same decoding the server applies: blank means "not given", never 0.
  const value = NUMERIC.has(name) ? numberOrUndefined(raw) : raw;

  // A blank repeated amount is a row the decoder drops, not an error.
  if (name in REPEATED && value === undefined) return null;

  const result = schema.safeParse(value);
  if (!result.success) return result.error.issues[0]?.message ?? "Check this field.";

  if (name === "baseLpa") {
    const base = numberOrUndefined(raw);
    const ctc = numberOrUndefined(siblings.ctcLpa ?? null);
    if (base !== undefined && ctc !== undefined && base > ctc) return BASE_ABOVE_CTC;
  }

  return null;
}
