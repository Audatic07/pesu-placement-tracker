import type { OfferInputValues } from "@/lib/offers/submit";

/**
 * The synthetic 9999 cohort.
 *
 * Every row here is written as form input, not as a database row — the harness
 * feeds each one through the same validation and the same createOffer path a
 * student's submission takes. Nothing is inserted directly, so if the real path
 * has a bug this dataset cannot paper over it.
 *
 * It is shaped to exercise each analytic rather than to look plausible:
 *
 *   - all three cycles, all three tiers, plus offers with no package at all
 *     (which must land with a null tier, not a wrong one)
 *   - all six branches, so the branch breakdown is not a single column
 *   - CGPA correlated with CTC but noisy, so the regression has real signal and
 *     an r-squared below 1
 *   - every compensation component kind, so the headline-versus-cash metric has
 *     something to separate
 *   - companies deliberately spelled the way a student would type them
 *     ("Eternal", "Oracle(OFSS)"), so alias resolution is tested rather than
 *     assumed
 *   - one company reported by six students at a consistent package, so
 *     corroboration has a majority to find, and one wild figure so the outlier
 *     detector has something to flag
 */

export type SyntheticStudent = {
  srn: string;
  name: string;
  branchCode: string;
  campusCode: number;
  section: string;
};

export type SyntheticSubmission = {
  /** Index into STUDENTS. */
  student: number;
  offer: Omit<OfferInputValues, "batchYear">;
  /** What this row is here to prove. Printed by the harness. */
  exercises: string;
};

export const BATCH_YEAR = 9999;

const BRANCHES = ["CSE", "AIML", "ECE", "EEE", "MECH", "BT"] as const;

export const STUDENTS: SyntheticStudent[] = Array.from({ length: 34 }, (_unused, index) => {
  const branch = BRANCHES[index % BRANCHES.length]!;
  const code = { CSE: "CS", AIML: "AM", ECE: "EC", EEE: "EE", MECH: "ME", BT: "BT" }[branch];
  return {
    srn: `PES${(index % 2) + 1}UG95${code}${String(index + 1).padStart(3, "0")}`,
    name: `Test Student ${index + 1}`,
    branchCode: branch,
    campusCode: (index % 2) + 1,
    section: String.fromCharCode(65 + (index % 4)),
  };
});

/** Base shape so each row only states what it is testing. */
function offer(
  values: Partial<Omit<OfferInputValues, "batchYear">> &
    Pick<Omit<OfferInputValues, "batchYear">, "companyName" | "roleTitle" | "cycle">,
): Omit<OfferInputValues, "batchYear"> {
  return {
    roleFamily: "SDE",
    nature: "FTE_ONLY",
    components: [],
    locations: [],
    workMode: "UNKNOWN",
    eligibleBranches: [],
    acceptanceStatus: "ACCEPTED",
    showName: false,
    rounds: [],
    ...values,
  };
}

const OA = { kind: "ONLINE_ASSESSMENT", mode: "ONLINE", heldOn: "2025-08-12" } as const;
const TECH = { kind: "TECHNICAL_INTERVIEW", mode: "IN_PERSON", heldOn: "2025-08-19" } as const;
const HR = { kind: "HR", mode: "ONLINE", heldOn: "2025-08-26" } as const;

export const SUBMISSIONS: SyntheticSubmission[] = [
  // ---------------------------------------------------------------- tier 1
  {
    student: 0,
    exercises:
      "Tier 1 derivation; full component breakdown; headline-vs-cash gap; every reported term at once",
    offer: offer({
      companyName: "Northwind Labs",
      roleTitle: "SDE 1",
      cycle: "FULL_TIME",
      ctcLpa: 46,
      baseLpa: 20,
      cgpa: 9.4,
      priorInternshipCount: 2,
      locations: ["Bangalore"],
      workMode: "HYBRID",
      bondMonths: 24,
      announcedCgpaCutoff: 8.5,
      eligibleBranches: ["CSE", "AIML", "ECE"],
      difficultyRating: 4,
      showName: true,
      components: [
        { kind: "FIXED_BASE", amountLpa: 20, isOneTime: false },
        { kind: "VARIABLE_PAY", amountLpa: 3, isOneTime: false },
        { kind: "JOINING_BONUS", amountLpa: 4, isOneTime: true },
        { kind: "RSU", amountLpa: 15, isOneTime: false },
        { kind: "PERKS", amountLpa: 4, isOneTime: false },
      ],
      rounds: [
        { ...OA, difficulty: 4, topics: "DP, graphs" },
        { ...TECH, difficulty: 5, topics: "system design, OS" },
        { ...HR, difficulty: 2 },
      ],
      processNotes:
        "Two hard DSA questions in the OA, then a long design round. The recruiter was clear that most of the headline number is stock.",
    }),
  },
  {
    student: 1,
    exercises: "Alias resolution — a student typing 'Eternal' must join the imported company",
    offer: offer({
      companyName: "Eternal",
      roleTitle: "SDE I",
      cycle: "FULL_TIME",
      ctcLpa: 54,
      baseLpa: 24,
      cgpa: 9.1,
      roleFamily: "SDE",
      components: [
        { kind: "FIXED_BASE", amountLpa: 24, isOneTime: false },
        { kind: "RETENTION_BONUS", amountLpa: 24, isOneTime: true },
      ],
      rounds: [{ ...OA, difficulty: 5 }, { ...TECH, difficulty: 5 }],
    }),
  },
  {
    student: 2,
    exercises: "Alias resolution with punctuation — 'Oracle(OFSS)' must not create a new company",
    offer: offer({
      companyName: "Oracle(OFSS)",
      roleTitle: "Associate Application Developer",
      cycle: "FULL_TIME",
      ctcLpa: 21.4,
      baseLpa: 15.2,
      cgpa: 8.2,
      roleFamily: "SDE",
      rounds: [{ ...OA, difficulty: 3 }],
    }),
  },

  // ------------------------------------------- corroboration cluster (6 rows)
  ...[8.9, 8.4, 7.9, 8.7, 8.1, 9.0].map((cgpa, index) => ({
    student: 3 + index,
    exercises:
      index < 2
        ? "Corroboration cluster — needs a majority before confidence rises"
        : "Corroboration cluster — consistent reports must raise confidence; " +
          "cutoffs disagree slightly, so the column must take the median rather than the loudest",
    offer: offer({
      companyName: "Meridian Data",
      roleTitle: "Software Engineer",
      cycle: "FULL_TIME",
      ctcLpa: [18, 18.5, 18, 17.5, 18.2, 18]?.[index] ?? 18,
      baseLpa: 14,
      cgpa,
      roleFamily: index % 2 === 0 ? "SDE" : "DATA_ENGINEERING",
      // Six people who sat the same drive, remembering the announced bar
      // slightly differently. The median is 7.5; no single report sets it.
      announcedCgpaCutoff: [7.5, 7.5, 7, 8, 7.5, 7.5]?.[index] ?? 7.5,
      eligibleBranches: ["CSE", "AIML", "ECE", "EEE"],
      workMode: index % 3 === 0 ? "REMOTE" : "ONSITE",
      components: [
        { kind: "FIXED_BASE", amountLpa: 14, isOneTime: false },
        { kind: "JOINING_BONUS", amountLpa: 2, isOneTime: true },
      ],
      rounds: [
        { ...OA, difficulty: 3, topics: "arrays, SQL" },
        { ...TECH, difficulty: 4 },
      ],
    }),
  })),
  {
    student: 9,
    exercises: "OUTLIER — far above the median of six consistent reports; must flag, never block",
    offer: offer({
      companyName: "Meridian Data",
      roleTitle: "Software Engineer",
      cycle: "FULL_TIME",
      ctcLpa: 95,
      baseLpa: 60,
      cgpa: 7.2,
      rounds: [{ ...OA, difficulty: 1 }],
      processNotes: "Deliberately implausible figure, included to test outlier detection.",
    }),
  },

  // ---------------------------------------------------------------- tier 2
  ...[
    { company: "Cobalt Systems", ctc: 11.5, base: 9, cgpa: 8.0, family: "QA_SDET" as const },
    { company: "Cobalt Systems", ctc: 11.5, base: 9, cgpa: 7.4, family: "SDE" as const },
    { company: "Harbour Analytics", ctc: 9.2, base: 7.5, cgpa: 7.1, family: "ANALYST" as const },
    { company: "Harbour Analytics", ctc: 8.8, base: 7.2, cgpa: 6.9, family: "ANALYST" as const },
    { company: "Fenwick Consulting", ctc: 7.6, base: 6.4, cgpa: 7.8, family: "CONSULTING" as const },
    { company: "Fenwick Consulting", ctc: 7.6, base: 6.4, cgpa: 6.6, family: "CONSULTING" as const },
    { company: "Larkspur Energy", ctc: 6.5, base: 5.8, cgpa: 6.4, family: "EMBEDDED_HARDWARE" as const },
  ].map((row, index) => ({
    student: 10 + index,
    exercises: "Tier 2 band; role-family spread; branch eligibility reported by the student",
    offer: offer({
      companyName: row.company,
      roleTitle: "Engineer",
      cycle: "FULL_TIME" as const,
      ctcLpa: row.ctc,
      baseLpa: row.base,
      cgpa: row.cgpa,
      roleFamily: row.family,
      announcedCgpaCutoff: 6.5,
      // Deliberately wide: tier 2 companies open to branches tier 1 never
      // called, which is what makes the by-branch table say something.
      eligibleBranches: ["CSE", "AIML", "ECE", "EEE", "MECH", "BT"],
      workMode: "ONSITE" as const,
      components: [{ kind: "FIXED_BASE", amountLpa: row.base, isOneTime: false }],
      rounds: [{ ...OA, difficulty: 2 }, { ...HR, difficulty: 1 }],
    }),
  })),

  // ---------------------------------------------------------------- tier 3
  ...[
    { company: "Pinegrove Services", ctc: 4.5, cgpa: 6.2 },
    { company: "Pinegrove Services", ctc: 4.5, cgpa: 6.8 },
    { company: "Pinegrove Services", ctc: 4.5, cgpa: 7.0 },
    { company: "Kestrel Retail", ctc: 5.5, cgpa: 6.5 },
    { company: "Kestrel Retail", ctc: 5.8, cgpa: 6.1 },
  ].map((row, index) => ({
    student: 17 + index,
    exercises: "Tier 3 band; mass-recruiter weighting (many students, low package)",
    offer: offer({
      companyName: row.company,
      roleTitle: "Graduate Engineer Trainee",
      cycle: "FULL_TIME" as const,
      ctcLpa: row.ctc,
      baseLpa: row.ctc - 0.5,
      cgpa: row.cgpa,
      roleFamily: "NON_TECH" as const,
      rounds: [{ ...OA, difficulty: 1 }],
    }),
  })),

  // -------------------------------------------------------- six-month interns
  ...[
    { company: "Northwind Labs", stipend: 80000, cgpa: 9.2 },
    { company: "Meridian Data", stipend: 45000, cgpa: 8.3 },
    { company: "Cobalt Systems", stipend: 30000, cgpa: 7.6 },
    { company: "Harbour Analytics", stipend: 25000, cgpa: 7.0 },
  ].map((row, index) => ({
    student: 22 + index,
    exercises: "Six-month internship cycle; stipend statistics; internship length reported",
    offer: offer({
      companyName: row.company,
      roleTitle: "Software Engineering Intern",
      cycle: "SIX_MONTH_INTERNSHIP" as const,
      nature: "INTERNSHIP_PLUS_FTE" as const,
      stipendPerMonthInr: row.stipend,
      cgpa: row.cgpa,
      internshipDurationMonths: 6,
      workMode: index % 2 === 0 ? "HYBRID" : "ONSITE",
      rounds: [{ ...OA, difficulty: 3 }, { ...TECH, difficulty: 3 }],
    }),
  })),
  {
    student: 26,
    exercises: "Internship with NO package declared — tier must be null, not guessed",
    offer: offer({
      companyName: "Stillwater Robotics",
      roleTitle: "Research Intern",
      cycle: "SIX_MONTH_INTERNSHIP",
      nature: "INTERNSHIP_ONLY",
      stipendPerMonthInr: 35000,
      cgpa: 8.6,
      roleFamily: "RESEARCH",
      rounds: [{ ...TECH, difficulty: 4, topics: "control theory" }],
      processNotes: "No CTC was ever quoted — conversion is performance-based.",
    }),
  },

  // ------------------------------------------------------- summer internships
  ...[
    { company: "Northwind Labs", stipend: 100000, cgpa: 9.5 },
    { company: "Meridian Data", stipend: 60000, cgpa: 8.8 },
    { company: "Cobalt Systems", stipend: 40000, cgpa: 8.0 },
    { company: "Kestrel Retail", stipend: 20000, cgpa: 7.2 },
  ].map((row, index) => ({
    student: 27 + index,
    exercises: "Summer internship cycle",
    offer: offer({
      companyName: row.company,
      roleTitle: "Summer Analyst",
      cycle: "SUMMER_INTERNSHIP" as const,
      nature: "INTERNSHIP_ONLY" as const,
      stipendPerMonthInr: row.stipend,
      cgpa: row.cgpa,
      roleFamily: "DATA_SCIENCE" as const,
      rounds: [{ ...OA, difficulty: 3 }],
    }),
  })),

  // ---------------------------------------------------- one student, two cycles
  {
    student: 31,
    exercises: "A student holding both an internship and a full-time offer",
    offer: offer({
      companyName: "Harbour Analytics",
      roleTitle: "Data Intern",
      cycle: "SUMMER_INTERNSHIP",
      nature: "INTERNSHIP_ONLY",
      stipendPerMonthInr: 30000,
      cgpa: 8.4,
      roleFamily: "DATA_SCIENCE",
    }),
  },
  {
    student: 31,
    exercises: "…and their full-time offer, which must be allowed alongside the internship",
    offer: offer({
      companyName: "Northwind Labs",
      roleTitle: "SDE 1",
      cycle: "FULL_TIME",
      ctcLpa: 44,
      baseLpa: 19,
      cgpa: 8.4,
      components: [
        { kind: "FIXED_BASE", amountLpa: 19, isOneTime: false },
        { kind: "ESOP", amountLpa: 18, isOneTime: false },
        { kind: "RELOCATION", amountLpa: 1.5, isOneTime: true },
        { kind: "INSURANCE", amountLpa: 2, isOneTime: false },
        { kind: "GRATUITY", amountLpa: 0.9, isOneTime: false },
        { kind: "PROVIDENT_FUND", amountLpa: 1.8, isOneTime: false },
      ],
      rounds: [{ ...OA, difficulty: 4 }, { ...TECH, difficulty: 5 }, { ...HR, difficulty: 2 }],
    }),
  },

  // ------------------------------------------------------- declined / revoked
  {
    student: 32,
    exercises: "Declined offer — must still count in company statistics",
    offer: offer({
      companyName: "Cobalt Systems",
      roleTitle: "SDE 1",
      cycle: "FULL_TIME",
      ctcLpa: 11.5,
      baseLpa: 9,
      cgpa: 8.9,
      acceptanceStatus: "DECLINED",
    }),
  },
  {
    student: 33,
    exercises: "Revoked offer; named submission; every remaining component kind",
    offer: offer({
      companyName: "Larkspur Energy",
      roleTitle: "Graduate Engineer",
      cycle: "FULL_TIME",
      ctcLpa: 6.8,
      baseLpa: 5.5,
      cgpa: 7.3,
      showName: true,
      acceptanceStatus: "REVOKED",
      roleFamily: "EMBEDDED_HARDWARE",
      components: [
        { kind: "FIXED_BASE", amountLpa: 5.5, isOneTime: false },
        { kind: "OTHER", amountLpa: 1.3, isOneTime: false, note: "Shift allowance" },
      ],
      rounds: [{ ...TECH, difficulty: 2 }],
      preparationResources: "Standard aptitude preparation and core electronics revision.",
    }),
  },
];

/**
 * Submissions that MUST be rejected. Each one is a rule the server has to
 * enforce regardless of what the form allowed through.
 */
export const REJECTION_CASES: Array<{
  student: number;
  offer: Omit<OfferInputValues, "batchYear">;
  expects: string;
}> = [
  {
    student: 27,
    expects: "a second summer internship — quota is 1",
    offer: offer({
      companyName: "Cobalt Systems",
      roleTitle: "Summer Analyst",
      cycle: "SUMMER_INTERNSHIP",
      stipendPerMonthInr: 50000,
      cgpa: 9.5,
    }),
  },
  {
    student: 0,
    expects: "a second tier 1 full-time offer — quota is 1 per tier",
    offer: offer({
      companyName: "Meridian Data",
      roleTitle: "SDE 2",
      cycle: "FULL_TIME",
      ctcLpa: 38,
      baseLpa: 18,
      cgpa: 9.4,
    }),
  },
];
