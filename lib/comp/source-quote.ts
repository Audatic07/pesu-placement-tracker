/**
 * Normalize the exact package summary retained by the historical archive.
 * These are source quotes, never evidence of an awarded FTE package. Keep the
 * original note and canonical compensation untouched, including contradictions.
 */
export type SourceQuote = { baseLpa: number | null; ctcLpa: number | null };

export function historicalSourceQuote(offer: {
  id: string;
  source: string;
  studentId: string | null;
  processNotes: string | null;
  compensation: { rawNote: string | null } | null;
}): SourceQuote | null {
  if (offer.source !== "OFFICIAL_IMPORT" || offer.studentId !== null ||
      !/^handmade-[a-f0-9]{32}$/.test(offer.id) ||
      !/^Source: .+ · .+ · row \d+(?:-\d+)?\./.test(offer.processNotes ?? "")) return null;
  // Anchored and deliberately narrow: never extract arbitrary numbers from
  // prose, a range, an Excel date, or a contradictory compensation remark.
  const match = /^Source package: monthly internship stipend (?:unknown|\d+(?:\.\d+)?) INR; stated base (unknown|\d+(?:\.\d+)?) LPA; headline CTC (unknown|\d+(?:\.\d+)?) LPA\.(?:\s|$)/.exec(offer.compensation?.rawNote ?? "");
  if (!match) return null;
  const amount = (value: string) => value === "unknown" ? null : Number(value);
  const baseLpa = amount(match[1]!);
  const ctcLpa = amount(match[2]!);
  if ((baseLpa !== null && (!Number.isFinite(baseLpa) || baseLpa < 0 || baseLpa > 10000)) ||
      (ctcLpa !== null && (!Number.isFinite(ctcLpa) || ctcLpa < 0 || ctcLpa > 10000))) return null;
  return baseLpa === null && ctcLpa === null ? null : { baseLpa, ctcLpa };
}
