import type { OfferNature, RoleFamily, WorkMode } from "@/generated/prisma/enums";

/**
 * Classifying roles and reading the odds and ends out of note text.
 *
 * Role titles in the sheets range from "SDE" to "Edison Engineering
 * Development Program - Non CS" to "Back Connect Process Specialist". The
 * family is what makes "do data roles pay more than SDE roles" answerable, so
 * it is worth classifying even though the titles are a mess.
 *
 * Order matters: the first pattern to match wins, so the specific ones come
 * before the general ones.
 */

/**
 * Note on the patterns: a trailing `\b` after a truncated stem never matches —
 * `manag\b` cannot match inside "Manager", because g and e are both word
 * characters. Stems are therefore written `manag\w*`.
 */
const ROLE_PATTERNS: Array<[RegExp, RoleFamily]> = [
  [
    /\b(?:sdet|test\s*engineer|in\s*test|\bqa\b|quality\s*engineer|automation\s*testing|testing)\b/i,
    "QA_SDET",
  ],
  [/\b(?:cyber\s*sec|cybersecurity|security\s*engineer|infosec|application\s*security)\b/i, "CYBERSECURITY"],
  [/\b(?:site\s*reliability|\bsre\b|devops|platform\s*engineer|cloud\s*engineer|infra)\b/i, "DEVOPS_SRE"],
  [/\b(?:data\s*scientist|data\s*science|machine\s*learning|\bml\b|\bai\b|aiml|genai|deep\s*learning)\b/i, "DATA_SCIENCE"],
  [/\b(?:data\s*engineer|data\s*engineering|etl|data\s*ops)\b/i, "DATA_ENGINEERING"],
  [/\b(?:business\s*analyst|data\s*analyst|analyst|analytics|risk\s*analyst)\b/i, "ANALYST"],
  [/\b(?:embedded|firmware|hardware|vlsi|digital\s*design|verification\s*engineer|circuits|asic|device)\b/i, "EMBEDDED_HARDWARE"],
  [
    /\b(?:product\s*manag\w*|product\s*intern|technical\s*program\s*manag\w*|tpm|program\s*manag\w*)\b/i,
    "PRODUCT",
  ],
  [
    /\b(?:consultant|consulting|advisory|solutions?\s*specialist|solutions?\s*associate|associate\s*consultant)\b/i,
    "CONSULTING",
  ],
  [/\b(?:research|scientist|r\s*&\s*d|rnd)\b/i, "RESEARCH"],
  [
    /\b(?:sde|swe|software\s*(?:engineer|developer|development)|developer|programmer|full\s*stack|backend|frontend|back\s*end|front\s*end|mobile|android|ios|application\s*developer|technical|engineer)\b/i,
    "SDE",
  ],
  [/\b(?:sales|marketing|customer\s*success|operations|hr\b|recruit|content|designer|patent)\b/i, "NON_TECH"],
];

export function classifyRoleFamily(title: string | null | undefined): RoleFamily {
  if (!title) return "OTHER";
  for (const [pattern, family] of ROLE_PATTERNS) {
    if (pattern.test(title)) return family;
  }
  return "OTHER";
}

/**
 * Works out what an offer actually grants from the sheet's three headcount
 * columns. They are mutually exclusive by construction: a row records students
 * placed as internship-only, FTE-only, or both.
 */
export function natureFromHeadcounts(counts: {
  internship: number | null;
  fte: number | null;
  both: number | null;
}): OfferNature {
  const internship = counts.internship ?? 0;
  const fte = counts.fte ?? 0;
  const both = counts.both ?? 0;

  if (both > 0) return "INTERNSHIP_PLUS_FTE";
  if (fte > 0 && internship > 0) return "INTERNSHIP_PLUS_FTE";
  if (fte > 0) return "FTE_ONLY";
  if (internship > 0) return "INTERNSHIP_ONLY";
  return "FTE_ONLY";
}

/**
 * Refines the nature using the note text, which often states the arrangement
 * outright: "Coming only for Internship, conversion based on performance",
 * "FTE Only", "Only for internship but has performance based conversion".
 */
export function refineNatureFromNote(
  nature: OfferNature,
  note: string | null | undefined,
): OfferNature {
  if (!note) return nature;

  if (/\bfte\s*only\b|\bfull\s*time\s*(?:role\s*)?only\b|only\s*fte\b/i.test(note)) {
    return "FTE_ONLY";
  }
  if (/only\s*(?:for\s*)?intern(?:ship)?|coming\s*only\s*for\s*intern|internship\s*only/i.test(note)) {
    return "INTERNSHIP_ONLY";
  }
  // An offer that grants both, stated outright — "Internship + FTE". Placement
  // counts prove this in the older sheets, but a drive still being run has none
  // yet, so the note is the only signal.
  if (/intern(?:ship)?\s*[+&]\s*fte|intern(?:ship)?\s*(?:and|plus)\s*fte|fte\s*[+&]\s*intern(?:ship)?/i.test(note)) {
    return "INTERNSHIP_PLUS_FTE";
  }
  return nature;
}

/** "Job Location Hyderabad", "JL : Blr/Hyd", "Location : PAN India" */
export function parseLocations(note: string | null | undefined): string[] {
  if (!note) return [];

  const match =
    /(?:job\s*location|JL|location)\s*(?:is|:|-)?\s*([A-Za-z/,\s.&]+?)(?:\.|$|\n|;)/i.exec(note);
  if (!match?.[1]) return [];

  const CITY_ALIASES: Record<string, string> = {
    blr: "Bangalore",
    bengaluru: "Bangalore",
    bangalore: "Bangalore",
    hyd: "Hyderabad",
    hyderabad: "Hyderabad",
    pune: "Pune",
    mumbai: "Mumbai",
    chennai: "Chennai",
    coimbatore: "Coimbatore",
    delhi: "Delhi",
    noida: "Noida",
    gurgaon: "Gurgaon",
    kolkata: "Kolkata",
    "pan india": "PAN India",
  };

  return match[1]
    .split(/[/,]|\s+or\s+/i)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 1 && part.length < 24)
    .map((part) => CITY_ALIASES[part] ?? part.replace(/\b\w/g, (c) => c.toUpperCase()))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 6);
}

export function parseWorkMode(note: string | null | undefined): WorkMode {
  if (!note) return "UNKNOWN";
  if (/fully\s*remote|remote\s*job|work\s*from\s*home/i.test(note)) return "REMOTE";
  if (/hybrid/i.test(note)) return "HYBRID";
  return "UNKNOWN";
}

/** "Has a bond of 2.5 yrs", "bond of 2 years", "2 year service agreement" */
export function parseBondMonths(note: string | null | undefined): number | null {
  if (!note) return null;

  const years = /bond\s*(?:period\s*)?(?:of\s*)?(\d+(?:\.\d+)?)\s*(?:yrs?|years?)/i.exec(note);
  if (years?.[1]) return Math.round(Number.parseFloat(years[1]) * 12);

  const months = /bond\s*(?:period\s*)?(?:of\s*)?(\d+)\s*(?:months?|mos?)/i.exec(note);
  if (months?.[1]) return Number.parseInt(months[1], 10);

  return null;
}

/** "Internship period from 6 - 10 months", "6 months internship", "12 month internship" */
export function parseInternshipMonths(note: string | null | undefined): number | null {
  if (!note) return null;

  const range = /intern(?:ship)?\s*(?:period\s*)?(?:from\s*)?(\d+)\s*[-–]\s*(\d+)\s*months?/i.exec(note);
  if (range?.[2]) return Number.parseInt(range[2], 10);

  const single = /(\d+)\s*months?\s*(?:of\s*)?intern|intern(?:ship)?\s*(?:for\s*|of\s*|duration\s*[-:]?\s*)?(\d+)\s*months?/i.exec(note);
  const value = single?.[1] ?? single?.[2];
  if (value) return Number.parseInt(value, 10);

  return null;
}

/** Splits the "Eligible Branches" cell: "CSE, AIML, ECE" */
export function parseEligibleBranches(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(/[,/]/)
    .map((part) => part.trim().toUpperCase())
    .filter((part) => /^(CSE|AIML|ECE|EEE|MECH|BT)$/.test(part));
}
