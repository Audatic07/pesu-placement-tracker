import type { GpaCutoffKind } from "@/generated/prisma/enums";

/**
 * Parsing the GPA cutoff column.
 *
 * The sheets record cutoffs as free text, and the text carries meaning the
 * number alone does not:
 *
 *   9.0                                     a hard bar
 *   "8(+ Resume)"                           nominal bar, resume decides
 *   "Resume Based"                          no numeric bar at all
 *   "8.91 + (10th &12th > 90)"              a bar plus school marks
 *   "7 (Mostly Resume Based and 8.5+)"      the stated bar is not the real one
 *   "6.8 (9 for CSE/AIML)"                  different bars per branch
 *   "Shortlisted(102 students) 8.5 + CGPA with Excellent projects"
 *   "N/A"                                   explicitly open
 *
 * The raw string is always kept. The parsed number is a convenience for
 * filtering and for the "which drives do I clear?" feature; the kind is what
 * stops a student reading "7" as a promise when the note says the real bar was
 * 8.5 and a good resume.
 */

export type ParsedGpaCutoff = {
  numeric: number | null;
  kind: GpaCutoffKind;
  raw: string;
  /** True when the text implies different bars for different branches. */
  isBranchSpecific: boolean;
};

const RESUME_MARKERS = /resume|profile\s*based|project|open\s*source|github|leetcode|cf\b/i;
const OPEN_MARKERS = /^(?:n\/a|na|none|no\s*cutoff|open|-)$/i;

export function parseGpaCutoff(value: unknown): ParsedGpaCutoff {
  if (value === null || value === undefined) {
    return { numeric: null, kind: "UNKNOWN", raw: "", isBranchSpecific: false };
  }

  if (typeof value === "number") {
    return {
      numeric: Number.isFinite(value) && value > 0 && value <= 10 ? value : null,
      kind: "STRICT",
      raw: String(value),
      isBranchSpecific: false,
    };
  }

  const raw = String(value).replace(/\s+/g, " ").trim();
  if (!raw) {
    return { numeric: null, kind: "UNKNOWN", raw: "", isBranchSpecific: false };
  }

  if (OPEN_MARKERS.test(raw)) {
    return { numeric: null, kind: "NONE", raw, isBranchSpecific: false };
  }

  // Any number in 0-10 with at most two decimals is a plausible CGPA. Anything
  // larger ("102 students", "90" for board marks) is not.
  const candidates = [...raw.matchAll(/\d+(?:\.\d+)?/g)]
    .map((match) => ({ value: Number.parseFloat(match[0]), index: match.index }))
    .filter((candidate) => candidate.value > 0 && candidate.value <= 10);

  const numeric = candidates[0]?.value ?? null;
  const mentionsResume = RESUME_MARKERS.test(raw);

  // Branch-specific when a second, different CGPA appears alongside a branch
  // name: "6.8 (9 for CSE/AIML)".
  const isBranchSpecific =
    candidates.length > 1 &&
    /\b(?:CSE|AIML|ECE|EEE|MECH|BT|CS\b|for\s+[A-Z]{2,4})/i.test(raw);

  let kind: GpaCutoffKind;
  if (numeric === null) {
    kind = mentionsResume ? "RESUME_BASED" : "UNKNOWN";
  } else if (mentionsResume) {
    // A number AND a resume condition: the stated bar is not the whole story.
    kind = "MIXED";
  } else if (isBranchSpecific || candidates.length > 1) {
    kind = "MIXED";
  } else {
    kind = "STRICT";
  }

  return { numeric, kind, raw, isBranchSpecific };
}
