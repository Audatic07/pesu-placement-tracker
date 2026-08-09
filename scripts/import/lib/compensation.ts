import type { CompensationComponentKind } from "@/generated/prisma/enums";

/**
 * Turning compensation prose into structured components.
 *
 * This is the module that earns the whole rewrite. The sheets record Meesho at
 * 60 LPA and then, in a note column, that "All the extra money in CTC is
 * majorly retention bonus over a period of 4-5 years". SAP is 26 LPA of which
 * 3.5L is a joining bonus, 4L is RSUs vesting over three years, and 8L is
 * "Free Meals provided on campus, Free Transport for office commute" — real
 * benefits, and absolutely not salary.
 *
 * A student comparing offers on the headline number is comparing noise.
 *
 * The approach is positional rather than clause-based. An earlier version split
 * the prose into clauses and looked for one component per clause; that broke on
 * "Joining Bonus: 2,00,000 New Hire RSU's: 4,00,000", where two components share
 * a clause, and on decimal points and Indian digit grouping, which are not
 * delimiters however much they look like one. Instead we locate every monetary
 * amount and every component label independently, then pair them by proximity,
 * nearest first. Amounts nobody claims and labels with no amount are both
 * reported for review rather than guessed at.
 */

export type ParsedComponent = {
  kind: CompensationComponentKind;
  amount: number;
  currency: string;
  isLpa: boolean;
  isOneTime: boolean;
  isCash: boolean;
  vestingYears: number | null;
  note: string;
};

export type ParsedCompensationNote = {
  components: ParsedComponent[];
  /** Text that mentions money but could not be read confidently. */
  unrecognised: string[];
};

type Rule = {
  kind: CompensationComponentKind;
  keywords: RegExp;
  isOneTime: boolean;
  isCash: boolean;
};

/** Order matters: the first rule whose keyword matches at a position wins. */
const RULES: Rule[] = [
  {
    kind: "JOINING_BONUS",
    keywords: /\b(?:joining\s*bonus|signing\s*bonus|sign[-\s]?on\s*bonus|JB)\b/gi,
    isOneTime: true,
    isCash: true,
  },
  {
    kind: "RETENTION_BONUS",
    keywords: /\b(?:retention\s*bonus|retention|deferred\s*bonus|RB|DB)\b/gi,
    isOneTime: true,
    isCash: true,
  },
  {
    kind: "RELOCATION",
    keywords: /\b(?:relocation|relocation\s*bonus)\b/gi,
    isOneTime: true,
    isCash: true,
  },
  {
    kind: "RSU",
    keywords: /\b(?:RSUs?|RSU's|restricted\s*stock(?:\s*units?)?)\b/gi,
    isOneTime: false,
    isCash: false,
  },
  {
    kind: "ESOP",
    keywords: /\b(?:ESOPs?|ESOP's|stock\s*options?|equity)\b/gi,
    isOneTime: false,
    isCash: false,
  },
  {
    kind: "VARIABLE_PAY",
    keywords: /\b(?:variable(?:\s*pay)?|performance\s*(?:pay|bonus|linked)|incentive)\b/gi,
    isOneTime: false,
    isCash: true,
  },
  {
    kind: "INSURANCE",
    keywords: /\b(?:insurance|medical\s*(?:cover|insurance)|health\s*cover)\b/gi,
    isOneTime: false,
    isCash: false,
  },
  {
    kind: "PERKS",
    keywords: /\b(?:benefits?|perks?|retirals?|wellness)\b/gi,
    isOneTime: false,
    isCash: false,
  },
  {
    kind: "FIXED_BASE",
    keywords: /\b(?:fixed(?:\s*pay)?|annual\s*fixed|base(?:\s*pay)?)\b/gi,
    isOneTime: false,
    isCash: true,
  },
];

type FoundAmount = {
  start: number;
  end: number;
  amount: number;
  currency: string;
  isLpa: boolean;
  text: string;
};

type FoundLabel = {
  start: number;
  end: number;
  rule: Rule;
  text: string;
};

/** "$18", "18$", "USD 40000" */
const USD_AMOUNT = /(?:USD\s*|\$\s*)([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*\$/gi;

/** "2L", "3.5 Lakhs", "6 lacs", "1.73 LPA", "2 Cr" */
const UNIT_AMOUNT =
  /(\d+(?:\.\d+)?)\s*(LPA|lakhs?|lacs?|crores?|L|Cr)\b/gi;

/** "Rs 25,000", "INR 2,00,000", "₹6" */
const RUPEE_PREFIXED = /(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?)/gi;

/** A bare number: "2,00,000", "1600", "3.5". Only used near a component label. */
const BARE_NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/**
 * Words that make a nearby number something other than an amount of money:
 * "vested 4 years", "2 installments", "1600 units", "15% variable".
 *
 * The optional leading range handles "over a period of 4-5 years", where the
 * 4 is the start of a duration and not four lakhs of retention bonus. Meesho's
 * note reads exactly that way, and without this the 4 was paired with the
 * neighbouring "retention bonus" label and inflated its first-year cash.
 */
const NOT_AN_AMOUNT_AFTER =
  /^\s*(?:[-–]\s*\d+\s*)?(?:%|years?|yrs?|months?|installments?|units?|students?|people|hire[ds]?|rounds?|x\b)/i;

/** "vested 4 years", "vest quarterly over three years", "over a period of 2 years" */
const VESTING =
  /vest(?:ed|ing|s)?[^.]{0,60}?(?:over\s+(?:a\s+period\s+of\s+)?)?(\d+|two|three|four|five|six)\s*[-\s]?\s*(?:year|yr)/gi;

const WORD_NUMBERS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

/**
 * Patterns that mean "do not try to compute a figure from this".
 * "1600 units at 18$" is a unit count and a unit price, not an amount; naively
 * multiplying them would produce a confident wrong number.
 */
const DO_NOT_COMPUTE = /\d[\d,]*\s*units?\s*(?:at|@)\s*/i;

/**
 * How far apart a label and an amount may sit and still belong together.
 *
 * Kept deliberately tight. In the source corpus a genuine pair is never more
 * than about a dozen characters apart ("ESOPs worth 15 lakhs" is 7). A looser
 * window lets a stray label reach across the sentence: "retirals" in Kickdrum's
 * note would otherwise claim the unrelated "3 Lakhs (Special Bonus)".
 */
const PAIRING_WINDOW = 25;

function toNumber(raw: string): number | null {
  const value = Number.parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function collectAmounts(note: string): FoundAmount[] {
  const found: FoundAmount[] = [];
  const claimed: Array<[number, number]> = [];

  const overlaps = (start: number, end: number) =>
    claimed.some(([s, e]) => start < e && end > s);

  const push = (match: RegExpExecArray, amount: number, currency: string, isLpa: boolean) => {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(start, end)) return;
    claimed.push([start, end]);
    found.push({ start, end, amount, currency, isLpa, text: match[0] });
  };

  // Dollars first: "$18" must not later be read as the bare number 18.
  for (const match of note.matchAll(USD_AMOUNT)) {
    const amount = toNumber(match[1] ?? match[2] ?? "");
    if (amount !== null && amount > 0) push(match, amount, "USD", false);
  }

  // Then explicit lakh/crore units.
  for (const match of note.matchAll(UNIT_AMOUNT)) {
    const amount = toNumber(match[1] ?? "");
    if (amount === null || amount <= 0) continue;
    const unit = match[2] ?? "";
    const lpa = /^cr/i.test(unit) ? amount * 100 : amount;
    push(match, lpa, "INR", true);
  }

  // Then rupee-prefixed absolute figures.
  for (const match of note.matchAll(RUPEE_PREFIXED)) {
    const amount = toNumber(match[1] ?? "");
    if (amount === null || amount <= 0) continue;
    push(match, amount / 100_000, "INR", true);
  }

  // Finally bare numbers. These are the riskiest, so they are filtered hard:
  // anything followed by a unit-of-something word is not money.
  for (const match of note.matchAll(BARE_NUMBER)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(start, end)) continue;
    if (NOT_AN_AMOUNT_AFTER.test(note.slice(end))) continue;

    const amount = toNumber(match[0]);
    if (amount === null || amount <= 0) continue;

    // Grouped or large figures are rupees; small bare numbers next to a
    // component label are lakhs, which is how these sheets are written.
    const isRupees = amount >= 1000;
    push(match, isRupees ? amount / 100_000 : amount, "INR", true);
  }

  return found.sort((a, b) => a.start - b.start);
}

function collectLabels(note: string): FoundLabel[] {
  const found: FoundLabel[] = [];
  const claimed: Array<[number, number]> = [];

  for (const rule of RULES) {
    rule.keywords.lastIndex = 0;
    for (const match of note.matchAll(rule.keywords)) {
      const start = match.index;
      const end = start + match[0].length;
      if (claimed.some(([s, e]) => start < e && end > s)) continue;
      claimed.push([start, end]);
      found.push({ start, end, rule, text: match[0] });
    }
  }

  return found.sort((a, b) => a.start - b.start);
}

function vestingNear(note: string, position: number): number | null {
  VESTING.lastIndex = 0;
  let best: { distance: number; years: number } | null = null;

  for (const match of note.matchAll(VESTING)) {
    const token = (match[1] ?? "").toLowerCase();
    const years = WORD_NUMBERS[token] ?? Number.parseInt(token, 10);
    if (!Number.isFinite(years)) continue;

    const distance = Math.abs(match.index - position);
    if (!best || distance < best.distance) best = { distance, years };
  }

  return best && best.distance <= 120 ? best.years : null;
}

/** A readable slice of the original note, for the component's provenance. */
function contextAround(note: string, start: number, end: number): string {
  return note.slice(Math.max(0, start - 30), Math.min(note.length, end + 30)).trim();
}

export function parseCompensationNote(
  note: string | null | undefined,
): ParsedCompensationNote {
  if (!note || !note.trim()) return { components: [], unrecognised: [] };

  const text = note.replace(/\s+/g, " ").trim();
  const unrecognised: string[] = [];

  if (DO_NOT_COMPUTE.test(text)) {
    // "1600 units at 18$": a count and a unit price. Refuse rather than invent.
    unrecognised.push(text);
    return { components: [], unrecognised };
  }

  const amounts = collectAmounts(text);
  const labels = collectLabels(text);

  if (labels.length === 0 && amounts.length === 0) {
    return { components: [], unrecognised };
  }

  // Pair each label with its nearest unclaimed amount, closest pair first, so a
  // label never steals an amount that sits right beside a different label.
  type Pair = { label: number; amount: number; distance: number };
  const pairs: Pair[] = [];

  labels.forEach((label, labelIndex) => {
    // "Joining Bonus: 2,00,000" — a label followed by a separator and an amount
    // binds to THAT amount, whatever sits behind it. Walmart's note reads
    // "…Target Total Cash: 2,009,000 Joining Bonus: 2,00,000", where the
    // preceding figure is marginally closer and would otherwise win, making the
    // joining bonus ten times its real size.
    const gap = /^\s*[:=–-]?\s*/.exec(text.slice(label.end))?.[0].length ?? 0;
    const boundIndex = amounts.findIndex((amount) => amount.start === label.end + gap);

    amounts.forEach((amount, amountIndex) => {
      if (boundIndex >= 0 && amountIndex !== boundIndex) return;

      const distance =
        amount.start >= label.end ? amount.start - label.end : label.start - amount.end;
      if (distance >= 0 && distance <= PAIRING_WINDOW) {
        pairs.push({
          label: labelIndex,
          amount: amountIndex,
          distance: amountIndex === boundIndex ? -1 : distance,
        });
      }
    });
  });

  pairs.sort((a, b) => a.distance - b.distance);

  const usedLabels = new Set<number>();
  const usedAmounts = new Set<number>();
  const components: ParsedComponent[] = [];

  for (const pair of pairs) {
    if (usedLabels.has(pair.label) || usedAmounts.has(pair.amount)) continue;
    usedLabels.add(pair.label);
    usedAmounts.add(pair.amount);

    const label = labels[pair.label]!;
    const amount = amounts[pair.amount]!;

    components.push({
      kind: label.rule.kind,
      amount: amount.amount,
      currency: amount.currency,
      isLpa: amount.isLpa,
      isOneTime: label.rule.isOneTime,
      isCash: label.rule.isCash,
      vestingYears: label.rule.isCash ? null : vestingNear(text, amount.start),
      note: contextAround(text, Math.min(label.start, amount.start), Math.max(label.end, amount.end)),
    });
  }

  // A component named but never quantified — "Has Retention Bonus" — is real
  // information a student should see, but it cannot go in a chart. Report it
  // only if that kind got no amount anywhere in the note.
  const quantifiedKinds = new Set(components.map((component) => component.kind));
  for (const [index, label] of labels.entries()) {
    if (usedLabels.has(index)) continue;
    if (quantifiedKinds.has(label.rule.kind)) continue;
    quantifiedKinds.add(label.rule.kind);
    unrecognised.push(text);
  }

  // Money we found but could not attribute. Only worth reporting when the note
  // is clearly an itemised breakdown — i.e. we already understood part of it —
  // otherwise every restated CTC figure would be flagged as a mystery.
  if (components.length > 0 && usedAmounts.size < amounts.length && unrecognised.length === 0) {
    const orphans = amounts
      .filter((_, index) => !usedAmounts.has(index))
      .map((amount) => amount.text);
    unrecognised.push(
      `Unattributed amount(s) ${orphans.join(", ")} in: ${text}`,
    );
  }

  return { components, unrecognised };
}

/**
 * Reads a compensation cell that is not a clean number.
 *
 * The sheets contain "10 (+1)", "6.25 (+ 0.75)", "21 (Only on conversion)",
 * "(Not disclosed)", "PBC", "Base + PF + ESOPs", "-" and blanks. Returns the
 * primary figure plus whatever qualifier came with it.
 */
export type ParsedAmountCell = {
  value: number | null;
  /** An explicit extra, as in "10 (+1)". */
  additional: number | null;
  /** Performance-based conversion: the package depends on the internship. */
  isPerformanceBased: boolean;
  isUndisclosed: boolean;
  raw: string;
  qualifier: string | null;
};

export function parseAmountCell(value: unknown): ParsedAmountCell {
  const empty: ParsedAmountCell = {
    value: null,
    additional: null,
    isPerformanceBased: false,
    isUndisclosed: false,
    raw: "",
    qualifier: null,
  };

  if (value === null || value === undefined) return empty;

  if (typeof value === "number") {
    return { ...empty, value: Number.isFinite(value) ? value : null, raw: String(value) };
  }

  const raw = String(value).replace(/\s+/g, " ").trim();
  if (!raw || raw === "-" || raw === "--") return { ...empty, raw };

  const lowered = raw.toLowerCase();

  if (/\bpbc\b|performance\s*based/.test(lowered)) {
    return { ...empty, raw, isPerformanceBased: true };
  }

  if (/not\s*disclosed|undisclosed|^tbd|^n\/a$/.test(lowered)) {
    return { ...empty, raw, isUndisclosed: true };
  }

  const withExtra = /^(\d+(?:\.\d+)?)\s*\(\s*\+\s*(\d+(?:\.\d+)?)\s*\)/.exec(raw);
  if (withExtra?.[1] && withExtra[2]) {
    return {
      ...empty,
      raw,
      value: Number.parseFloat(withExtra[1]),
      additional: Number.parseFloat(withExtra[2]),
    };
  }

  const leading = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(raw);
  if (leading?.[1]) {
    const qualifier = leading[2]?.trim();
    return {
      ...empty,
      raw,
      value: Number.parseFloat(leading[1]),
      qualifier: qualifier ? qualifier : null,
    };
  }

  // No number at all — "Base + PF + ESOPs". Real information, but not a figure.
  return { ...empty, raw, qualifier: raw, isUndisclosed: true };
}
