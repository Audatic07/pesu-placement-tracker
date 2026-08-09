import type { OfferInputValues } from "@/lib/offers/submit";

/**
 * The dummy 9998 cohort — 200 submissions from 170 students.
 *
 * It exists to answer "what does the app look like with a real season's worth
 * of data in it", which is a question a fixture of thirty rows cannot answer.
 * Empty states, five-row tables and single-bar histograms tell you nothing
 * about whether a page holds up, and neither does an analytics query that
 * never sees a hundred rows.
 *
 * Everything here is generated from a fixed seed, so the batch is byte-identical
 * on every machine and every rebuild. Nothing is random at runtime.
 *
 * Deliberate properties of the shape, none of them accidental:
 *
 *   - The tier pyramid is honest. Thirty tier-1 offers against fifty-eight in
 *     tier 2 and thirty-eight in tier 3 is roughly what the source spreadsheets
 *     describe. A demo that is 40% tier 1 would be a recruitment poster, and
 *     PRODUCT.md says this app is never flattering.
 *   - Company names are invented. Attaching fabricated packages to real
 *     employers on a public deployment would be a lie about identifiable
 *     companies, so the entire universe is fictional.
 *   - Several companies are typed the way a tired student types them — lower
 *     case, doubled spaces, a stray hyphen. All of those normalise to the same
 *     identity key, so the run proves alias resolution holds at volume rather
 *     than on a couple of hand-picked cases.
 *   - CGPA tracks CTC with real noise on top, so the regression has signal and
 *     an r-squared below 1 instead of a straight line.
 *   - Two packages are deliberately implausible, one high and one low, so the
 *     outlier detector has something to catch in a crowd rather than in a
 *     three-row table.
 *   - Anonymity dominates: roughly one submission in eight opts into a name.
 */

export const BATCH_YEAR = 9998;

/** Fixed seed. Change it and you get a different — but equally stable — cohort. */
const SEED = 0x9998_7a3c;

/**
 * Deterministic PRNG (mulberry32). A demo batch that differs between machines
 * cannot be used to reproduce a bug someone else saw.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom(SEED);

/** Uniform integer in [min, max]. */
function int(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

/** Roughly normal, via the mean of four uniforms. Range [-1, 1]. */
function jitter(): number {
  return ((random() + random() + random() + random()) / 2 - 1) * 1.0;
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export type DummyStudent = {
  srn: string;
  name: string;
  branchCode: string;
  campusCode: number;
  section: string;
  semester: string;
};

export const STUDENT_COUNT = 170;

/**
 * Branch mix, weighted the way the source workbooks are: computer science and
 * its AI/ML variant are more than half the cohort, biotechnology is a sliver.
 * A demo with six equal columns would hide exactly the imbalance the branch
 * breakdown exists to show.
 */
const BRANCH_MIX: Array<{ code: string; srnCode: string; weight: number }> = [
  { code: "CSE", srnCode: "CS", weight: 34 },
  { code: "AIML", srnCode: "AM", weight: 20 },
  { code: "ECE", srnCode: "EC", weight: 18 },
  { code: "EEE", srnCode: "EE", weight: 10 },
  { code: "MECH", srnCode: "ME", weight: 11 },
  { code: "BT", srnCode: "BT", weight: 7 },
];

/**
 * SRNs are built so they can never collide with a real one.
 *
 * The serial is four digits starting at 9001; PESU issues three. The admission
 * year is 24, which resolves through the real parser to a graduating year of
 * 2028 — a batch the seed already creates — so provisioning these students does
 * not quietly bring a junk batch into existence. Their graduating year is then
 * set to 9998 directly, because no SRN can encode a four-digit year.
 */
function buildStudents(): DummyStudent[] {
  const pool: string[] = [];
  for (const branch of BRANCH_MIX) {
    for (let i = 0; i < branch.weight; i += 1) pool.push(branch.code);
  }

  const students: DummyStudent[] = [];
  for (let index = 0; index < STUDENT_COUNT; index += 1) {
    const code = pool[index % pool.length]!;
    const branch = BRANCH_MIX.find((entry) => entry.code === code)!;
    const campusCode = index % 3 === 2 ? 2 : 1;

    students.push({
      srn: `PES${campusCode}UG24${branch.srnCode}9${String(index + 1).padStart(3, "0")}`,
      name: `Demo Student ${String(index + 1).padStart(3, "0")}`,
      branchCode: branch.code,
      campusCode,
      section: String.fromCharCode(65 + (index % 6)),
      semester: "8",
    });
  }
  return students;
}

export const STUDENTS: DummyStudent[] = buildStudents();

// ---------------------------------------------------------------------------
// The company universe
// ---------------------------------------------------------------------------

type Cycle = OfferInputValues["cycle"];
type RoleFamily = OfferInputValues["roleFamily"];
type WorkMode = OfferInputValues["workMode"];

type DummyCompany = {
  /** Canonical spelling. */
  name: string;
  /**
   * How students actually type it. Every variant here differs only in case,
   * spacing or punctuation, so all of them normalise to one identity key — the
   * run asserts afterwards that no duplicate company row appeared.
   */
  spellings?: string[];
  roleFamily: RoleFamily;
  titles: string[];
  internTitle: string;
  /** Headline CTC for a full-time offer. null means it is never disclosed. */
  ctcLpa: number | null;
  /** Fraction of the headline that is fixed base pay. */
  baseRatio: number;
  stipendPerMonthInr: number | null;
  locations: string[];
  workMode: WorkMode;
  eligibleBranches: string[];
  announcedCgpaCutoff: number | null;
  bondMonths?: number;
  hires: { fullTime: number; sixMonth: number; summer: number };
};

const TECH_BRANCHES = ["CSE", "AIML", "ECE"];
const CORE_BRANCHES = ["ECE", "EEE", "MECH"];
const ALL_BRANCHES = ["CSE", "AIML", "ECE", "EEE", "MECH", "BT"];

/**
 * Thirty-four invented recruiters. Hire counts are fixed rather than drawn, so
 * the tier pyramid and the cycle mix are properties of the dataset instead of
 * something that drifts when the seed changes.
 *
 * Full-time totals: 30 tier 1, 58 tier 2, 38 tier 3, 6 undisclosed = 132.
 * Internships: 38 six-month, 30 summer. Grand total 200.
 */
const COMPANIES: DummyCompany[] = [
  // ------------------------------------------------------------- tier 1
  {
    name: "Northwind Labs",
    spellings: ["Northwind Labs", "northwind labs", "Northwind  Labs"],
    roleFamily: "SDE",
    titles: ["SDE 1", "Software Engineer I", "Member of Technical Staff"],
    internTitle: "Software Engineering Intern",
    ctcLpa: 42,
    baseRatio: 0.46,
    stipendPerMonthInr: 100000,
    locations: ["Bangalore", "Hyderabad"],
    workMode: "HYBRID",
    eligibleBranches: TECH_BRANCHES,
    announcedCgpaCutoff: 8.5,
    bondMonths: 12,
    hires: { fullTime: 4, sixMonth: 3, summer: 2 },
  },
  {
    name: "Silverpine Systems",
    roleFamily: "SDE",
    titles: ["Software Engineer", "SDE 1"],
    internTitle: "Software Engineer Intern",
    ctcLpa: 38,
    baseRatio: 0.5,
    stipendPerMonthInr: 85000,
    locations: ["Bangalore"],
    workMode: "ONSITE",
    eligibleBranches: TECH_BRANCHES,
    announcedCgpaCutoff: 8.0,
    hires: { fullTime: 3, sixMonth: 2, summer: 2 },
  },
  {
    name: "Ardent Quant",
    roleFamily: "RESEARCH",
    titles: ["Quantitative Researcher"],
    internTitle: "Quant Research Intern",
    ctcLpa: 55,
    baseRatio: 0.55,
    stipendPerMonthInr: 150000,
    locations: ["Mumbai"],
    workMode: "ONSITE",
    eligibleBranches: ["CSE", "AIML"],
    announcedCgpaCutoff: 9.0,
    hires: { fullTime: 1, sixMonth: 0, summer: 1 },
  },
  {
    name: "Vantage Cloud",
    spellings: ["Vantage Cloud", "VANTAGE CLOUD", "vantage cloud"],
    roleFamily: "DEVOPS_SRE",
    titles: ["Cloud Engineer", "Site Reliability Engineer"],
    internTitle: "Cloud Infrastructure Intern",
    ctcLpa: 32,
    baseRatio: 0.55,
    stipendPerMonthInr: 75000,
    locations: ["Bangalore", "Pune"],
    workMode: "HYBRID",
    eligibleBranches: TECH_BRANCHES,
    announcedCgpaCutoff: 8.0,
    hires: { fullTime: 4, sixMonth: 3, summer: 2 },
  },
  {
    name: "Blackwater Semiconductors",
    roleFamily: "EMBEDDED_HARDWARE",
    titles: ["Design Engineer", "Silicon Verification Engineer"],
    internTitle: "Hardware Design Intern",
    ctcLpa: 24,
    baseRatio: 0.65,
    stipendPerMonthInr: 60000,
    locations: ["Bangalore"],
    workMode: "ONSITE",
    eligibleBranches: ["ECE", "EEE"],
    announcedCgpaCutoff: 8.0,
    bondMonths: 24,
    hires: { fullTime: 3, sixMonth: 2, summer: 0 },
  },
  {
    name: "Halcyon AI",
    roleFamily: "DATA_SCIENCE",
    titles: ["Machine Learning Engineer", "Applied Scientist"],
    internTitle: "Machine Learning Intern",
    ctcLpa: 28,
    baseRatio: 0.6,
    stipendPerMonthInr: 70000,
    locations: ["Bangalore", "Remote"],
    workMode: "REMOTE",
    eligibleBranches: ["CSE", "AIML"],
    announcedCgpaCutoff: 8.5,
    hires: { fullTime: 3, sixMonth: 2, summer: 2 },
  },
  {
    name: "Orbital Payments",
    roleFamily: "SDE",
    titles: ["Backend Engineer", "SDE 1"],
    internTitle: "Backend Intern",
    ctcLpa: 21,
    baseRatio: 0.68,
    stipendPerMonthInr: 55000,
    locations: ["Bangalore", "Gurgaon"],
    workMode: "HYBRID",
    eligibleBranches: TECH_BRANCHES,
    announcedCgpaCutoff: 7.5,
    hires: { fullTime: 3, sixMonth: 0, summer: 2 },
  },
  {
    name: "Meridian Data",
    spellings: ["Meridian Data", "meridian data", "Meridian-Data"],
    roleFamily: "DATA_ENGINEERING",
    titles: ["Data Engineer", "Software Engineer"],
    internTitle: "Data Engineering Intern",
    ctcLpa: 18,
    baseRatio: 0.75,
    stipendPerMonthInr: 45000,
    locations: ["Hyderabad"],
    workMode: "ONSITE",
    eligibleBranches: ["CSE", "AIML", "ECE", "EEE"],
    announcedCgpaCutoff: 7.5,
    hires: { fullTime: 4, sixMonth: 3, summer: 3 },
  },
  {
    name: "Sablefish Trading",
    roleFamily: "RESEARCH",
    titles: ["Trading Systems Engineer"],
    internTitle: "Trading Intern",
    ctcLpa: 60,
    baseRatio: 0.4,
    stipendPerMonthInr: 175000,
    locations: ["Mumbai"],
    workMode: "ONSITE",
    eligibleBranches: ["CSE", "AIML"],
    announcedCgpaCutoff: 9.0,
    hires: { fullTime: 1, sixMonth: 0, summer: 1 },
  },
  {
    name: "Cinderpeak Software",
    roleFamily: "SDE",
    titles: ["Software Engineer", "Product Engineer"],
    internTitle: "Software Intern",
    ctcLpa: 16,
    baseRatio: 0.8,
    stipendPerMonthInr: 40000,
    locations: ["Bangalore"],
    workMode: "HYBRID",
    eligibleBranches: TECH_BRANCHES,
    announcedCgpaCutoff: 7.0,
    hires: { fullTime: 2, sixMonth: 0, summer: 0 },
  },
  {
    name: "Redwood Grid",
    roleFamily: "EMBEDDED_HARDWARE",
    titles: ["Power Systems Engineer"],
    internTitle: "Grid Engineering Intern",
    ctcLpa: 14.5,
    baseRatio: 0.82,
    stipendPerMonthInr: 35000,
    locations: ["Chennai", "Bangalore"],
    workMode: "ONSITE",
    eligibleBranches: ["EEE", "ECE", "MECH"],
    announcedCgpaCutoff: 7.0,
    bondMonths: 18,
    hires: { fullTime: 1, sixMonth: 2, summer: 0 },
  },
  {
    name: "Thornbury Networks",
    roleFamily: "CYBERSECURITY",
    titles: ["Security Engineer"],
    internTitle: "Security Intern",
    ctcLpa: 13,
    baseRatio: 0.8,
    stipendPerMonthInr: 35000,
    locations: ["Bangalore"],
    workMode: "HYBRID",
    eligibleBranches: TECH_BRANCHES,
    announcedCgpaCutoff: 7.5,
    hires: { fullTime: 1, sixMonth: 0, summer: 0 },
  },

  // ------------------------------------------------------------- tier 2
  {
    name: "Cobalt Systems",
    spellings: ["Cobalt Systems", "cobalt systems", "Cobalt  Systems", "COBALT SYSTEMS"],
    roleFamily: "QA_SDET",
    titles: ["Software Engineer", "SDET", "Associate Engineer"],
    internTitle: "Engineering Intern",
    ctcLpa: 11.5,
    baseRatio: 0.83,
    stipendPerMonthInr: 30000,
    locations: ["Bangalore", "Mysore"],
    workMode: "ONSITE",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: 6.5,
    bondMonths: 24,
    hires: { fullTime: 8, sixMonth: 3, summer: 3 },
  },
  {
    name: "Harbour Analytics",
    roleFamily: "ANALYST",
    titles: ["Business Analyst", "Data Analyst"],
    internTitle: "Analytics Intern",
    ctcLpa: 9.2,
    baseRatio: 0.85,
    stipendPerMonthInr: 25000,
    locations: ["Bangalore"],
    workMode: "HYBRID",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: 6.5,
    hires: { fullTime: 6, sixMonth: 3, summer: 2 },
  },
  {
    name: "Fenwick Consulting",
    roleFamily: "CONSULTING",
    titles: ["Associate Consultant", "Technology Analyst"],
    internTitle: "Consulting Intern",
    ctcLpa: 7.6,
    baseRatio: 0.88,
    stipendPerMonthInr: 22000,
    locations: ["Bangalore", "Gurgaon", "Pune"],
    workMode: "ONSITE",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: 6.0,
    hires: { fullTime: 7, sixMonth: 2, summer: 0 },
  },
  {
    name: "Larkspur Energy",
    roleFamily: "EMBEDDED_HARDWARE",
    titles: ["Graduate Engineer Trainee", "Field Engineer"],
    internTitle: "Engineering Intern",
    ctcLpa: 6.5,
    baseRatio: 0.9,
    stipendPerMonthInr: 18000,
    locations: ["Chennai", "Vadodara"],
    workMode: "ONSITE",
    eligibleBranches: CORE_BRANCHES,
    announcedCgpaCutoff: 6.0,
    bondMonths: 24,
    hires: { fullTime: 5, sixMonth: 0, summer: 0 },
  },
  {
    name: "Quillon Health",
    roleFamily: "SDE",
    titles: ["Software Engineer", "Platform Engineer"],
    internTitle: "Health Platform Intern",
    ctcLpa: 8.4,
    baseRatio: 0.86,
    stipendPerMonthInr: 25000,
    locations: ["Hyderabad", "Bangalore"],
    workMode: "HYBRID",
    eligibleBranches: ["CSE", "AIML", "ECE", "BT"],
    announcedCgpaCutoff: 6.5,
    hires: { fullTime: 4, sixMonth: 2, summer: 0 },
  },
  {
    name: "Marlowe Retail Tech",
    roleFamily: "SDE",
    titles: ["Software Engineer", "Associate Developer"],
    internTitle: "Retail Tech Intern",
    ctcLpa: 7.2,
    baseRatio: 0.88,
    stipendPerMonthInr: 20000,
    locations: ["Bangalore"],
    workMode: "ONSITE",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: 6.0,
    hires: { fullTime: 5, sixMonth: 0, summer: 2 },
  },
  {
    name: "Ashgrove Logistics",
    roleFamily: "ANALYST",
    titles: ["Operations Analyst", "Supply Chain Analyst"],
    internTitle: "Operations Intern",
    ctcLpa: 6.8,
    baseRatio: 0.9,
    stipendPerMonthInr: 18000,
    locations: ["Pune", "Nagpur"],
    workMode: "ONSITE",
    eligibleBranches: ["MECH", "ECE", "EEE", "BT"],
    announcedCgpaCutoff: 6.0,
    hires: { fullTime: 4, sixMonth: 0, summer: 0 },
  },
  {
    name: "Bramblewick Media",
    roleFamily: "PRODUCT",
    titles: ["Product Analyst", "Associate Product Manager"],
    internTitle: "Product Intern",
    ctcLpa: 10.5,
    baseRatio: 0.85,
    stipendPerMonthInr: 30000,
    locations: ["Mumbai", "Bangalore"],
    workMode: "HYBRID",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: 7.0,
    hires: { fullTime: 3, sixMonth: 0, summer: 2 },
  },
  {
    name: "Corvid Robotics",
    roleFamily: "EMBEDDED_HARDWARE",
    titles: ["Robotics Engineer", "Controls Engineer"],
    internTitle: "Robotics Intern",
    ctcLpa: 9.8,
    baseRatio: 0.86,
    stipendPerMonthInr: 28000,
    locations: ["Bangalore", "Coimbatore"],
    workMode: "ONSITE",
    eligibleBranches: ["MECH", "ECE", "EEE", "AIML"],
    announcedCgpaCutoff: 7.0,
    hires: { fullTime: 4, sixMonth: 2, summer: 2 },
  },
  {
    name: "Duneside Insurance",
    roleFamily: "NON_TECH",
    titles: ["Actuarial Associate", "Risk Analyst"],
    internTitle: "Risk Intern",
    ctcLpa: 7.9,
    baseRatio: 0.9,
    stipendPerMonthInr: 20000,
    locations: ["Mumbai"],
    workMode: "ONSITE",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: 6.5,
    hires: { fullTime: 4, sixMonth: 0, summer: 0 },
  },
  {
    name: "Everly Telecom",
    roleFamily: "EMBEDDED_HARDWARE",
    titles: ["Network Engineer", "RF Engineer"],
    internTitle: "Telecom Intern",
    ctcLpa: 6.2,
    baseRatio: 0.92,
    stipendPerMonthInr: 16000,
    locations: ["Bangalore", "Noida"],
    workMode: "ONSITE",
    eligibleBranches: ["ECE", "EEE"],
    announcedCgpaCutoff: 6.0,
    hires: { fullTime: 4, sixMonth: 0, summer: 1 },
  },
  {
    name: "Fairholt Bank",
    roleFamily: "SDE",
    titles: ["Technology Analyst", "Software Engineer"],
    internTitle: "Technology Intern",
    ctcLpa: 11,
    baseRatio: 0.84,
    stipendPerMonthInr: 30000,
    locations: ["Bangalore", "Chennai"],
    workMode: "HYBRID",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: 7.0,
    hires: { fullTime: 4, sixMonth: 2, summer: 0 },
  },

  // ------------------------------------------------------------- tier 3
  {
    name: "Pinegrove Services",
    spellings: ["Pinegrove Services", "pinegrove services", "Pinegrove   Services"],
    roleFamily: "NON_TECH",
    titles: ["Graduate Engineer Trainee", "Systems Engineer"],
    internTitle: "Trainee Intern",
    ctcLpa: 4.5,
    baseRatio: 0.94,
    stipendPerMonthInr: 12000,
    locations: ["Bangalore", "Chennai", "Pune"],
    workMode: "ONSITE",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: 6.0,
    bondMonths: 24,
    hires: { fullTime: 9, sixMonth: 0, summer: 0 },
  },
  {
    name: "Kestrel Retail",
    roleFamily: "NON_TECH",
    titles: ["Management Trainee", "Store Operations Trainee"],
    internTitle: "Retail Intern",
    ctcLpa: 5.5,
    baseRatio: 0.92,
    stipendPerMonthInr: 15000,
    locations: ["Bangalore", "Kochi"],
    workMode: "ONSITE",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: 5.5,
    hires: { fullTime: 6, sixMonth: 0, summer: 0 },
  },
  {
    name: "Umberfield IT Services",
    spellings: ["Umberfield IT Services", "umberfield it services", "Umberfield IT  Services"],
    roleFamily: "QA_SDET",
    titles: ["Systems Engineer", "Associate Software Engineer"],
    internTitle: "IT Intern",
    ctcLpa: 3.6,
    baseRatio: 0.95,
    stipendPerMonthInr: 10000,
    locations: ["Chennai", "Bhubaneswar", "Pune"],
    workMode: "ONSITE",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: 5.5,
    bondMonths: 24,
    hires: { fullTime: 8, sixMonth: 0, summer: 1 },
  },
  {
    name: "Vellum Solutions",
    roleFamily: "QA_SDET",
    titles: ["Test Engineer", "Associate Engineer"],
    internTitle: "QA Intern",
    ctcLpa: 4.2,
    baseRatio: 0.95,
    stipendPerMonthInr: 12000,
    locations: ["Hyderabad"],
    workMode: "ONSITE",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: 5.5,
    hires: { fullTime: 5, sixMonth: 0, summer: 0 },
  },
  {
    name: "Windrose Staffing",
    roleFamily: "NON_TECH",
    titles: ["Associate", "Process Executive"],
    internTitle: "Operations Intern",
    ctcLpa: 3,
    baseRatio: 0.96,
    stipendPerMonthInr: 9000,
    locations: ["Bangalore"],
    workMode: "ONSITE",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: null,
    hires: { fullTime: 4, sixMonth: 0, summer: 0 },
  },
  {
    name: "Yarrowgate Systems",
    roleFamily: "SDE",
    titles: ["Junior Developer"],
    internTitle: "Developer Intern",
    ctcLpa: 5,
    baseRatio: 0.94,
    stipendPerMonthInr: 14000,
    locations: ["Mangalore", "Bangalore"],
    workMode: "ONSITE",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: 6.0,
    hires: { fullTime: 3, sixMonth: 0, summer: 0 },
  },
  {
    name: "Zephyr BPO",
    roleFamily: "NON_TECH",
    titles: ["Customer Solutions Associate"],
    internTitle: "Support Intern",
    ctcLpa: 3.4,
    baseRatio: 0.97,
    stipendPerMonthInr: 9000,
    locations: ["Bangalore", "Hyderabad"],
    workMode: "ONSITE",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: null,
    hires: { fullTime: 3, sixMonth: 0, summer: 0 },
  },

  // ------------------------------------- packages nobody was ever told
  {
    name: "Stillwater Robotics",
    roleFamily: "RESEARCH",
    titles: ["Research Associate"],
    internTitle: "Research Intern",
    ctcLpa: null,
    baseRatio: 1,
    stipendPerMonthInr: 35000,
    locations: ["Bangalore"],
    workMode: "HYBRID",
    eligibleBranches: ["ECE", "MECH", "AIML"],
    announcedCgpaCutoff: 8.0,
    hires: { fullTime: 2, sixMonth: 3, summer: 2 },
  },
  {
    name: "Alder and Vine Studio",
    spellings: ["Alder and Vine Studio", "alder and vine studio", "Alder And Vine Studio"],
    roleFamily: "PRODUCT",
    titles: ["Design Technologist"],
    internTitle: "Design Intern",
    ctcLpa: null,
    baseRatio: 1,
    stipendPerMonthInr: 25000,
    locations: ["Bangalore", "Remote"],
    workMode: "REMOTE",
    eligibleBranches: ALL_BRANCHES,
    announcedCgpaCutoff: null,
    hires: { fullTime: 2, sixMonth: 2, summer: 0 },
  },
  {
    name: "Brightwater Genomics",
    roleFamily: "RESEARCH",
    titles: ["Bioinformatics Associate"],
    internTitle: "Genomics Intern",
    ctcLpa: null,
    baseRatio: 1,
    stipendPerMonthInr: 20000,
    locations: ["Bangalore"],
    workMode: "ONSITE",
    eligibleBranches: ["BT", "AIML", "CSE"],
    announcedCgpaCutoff: 7.0,
    hires: { fullTime: 2, sixMonth: 2, summer: 0 },
  },
];

// ---------------------------------------------------------------------------
// Prose fragments. Enough variety that the offer pages do not read as one
// paragraph repeated two hundred times.
// ---------------------------------------------------------------------------

const PROCESS_NOTES = [
  "The online assessment was two medium DSA questions and a short aptitude section. Interviews were mostly resume-driven.",
  "Three rounds in one day. The second interviewer went deep on operating systems; the third was almost entirely projects.",
  "Shortlisting was purely on CGPA, then a single technical round. Results came the same evening.",
  "Long process — six weeks between the pre-placement talk and the offer letter. Worth knowing before you plan around it.",
  "The assessment platform kept timing out, so the deadline was extended. Interviews were calm and conversational.",
  "They asked for a system design walkthrough even for a fresher role. Prepare at least one project end to end.",
  "Two coding rounds back to back, then HR. The HR round was not a formality — they asked about location preference seriously.",
  "Group discussion first, which surprised most people. Then one technical and one managerial round.",
  "The recruiter was upfront that the headline number includes a retention component paid out over several years.",
  "Take-home assignment over a weekend, followed by a review call on the submission. No whiteboard rounds at all.",
];

const PREP_NOTES = [
  "Standard DSA preparation — arrays, strings, trees, and one pass over dynamic programming.",
  "Core subjects mattered more than DSA here. Revise DBMS and operating systems properly.",
  "Aptitude practice and one mock interview were enough for this one.",
  "Read the company's engineering blog before the managerial round; it came up directly.",
  "Projects on the resume were questioned line by line. Do not list anything you cannot defend.",
];

const TOPIC_SETS = [
  "arrays, strings",
  "DP, graphs",
  "trees, recursion",
  "SQL, joins",
  "OS, DBMS",
  "system design, scalability",
  "OOP, design patterns",
  "aptitude, logical reasoning",
  "circuits, signals",
  "statistics, probability",
];

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export type DummySubmission = {
  /** Index into STUDENTS. */
  student: number;
  /** The name typed into the company field, which may be a messy spelling. */
  typedCompanyName: string;
  /** Set on the two rows written to be implausible. The runner asserts on them. */
  outlier: "high" | "low" | null;
  offer: Omit<OfferInputValues, "batchYear">;
};

type Plan = { company: DummyCompany; cycle: Cycle; outlier: "high" | "low" | null };

type Schedule = { rounds: string[]; offerDate: string };

/** What an outlier row multiplies the company's headline package by. */
const OUTLIER_MULTIPLIER = { high: 2.4, low: 0.42 } as const;

/** Season dates for this batch: August of 9997 through February of 9998. */
function seasonDate(monthOffset: number, day: number): string {
  const month = 8 + monthOffset; // 8 = August
  const year = month > 12 ? BATCH_YEAR : BATCH_YEAR - 1;
  const normalized = month > 12 ? month - 12 : month;
  return `${year}-${String(normalized).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Companies hire earlier the more they pay, which is what the source sheets
 * show and what makes the season timeline worth looking at.
 */
function scheduleFor(company: DummyCompany): Schedule {
  const headline = company.ctcLpa ?? 8;
  const startMonth = headline >= 30 ? 0 : headline >= 15 ? 1 : headline >= 7 ? 3 : 5;
  const drift = int(0, 1);
  const first = startMonth + drift;
  return {
    rounds: [
      seasonDate(first, int(3, 26)),
      seasonDate(first, int(3, 26)),
      seasonDate(first + 1, int(3, 26)),
    ],
    offerDate: seasonDate(first + 1, int(3, 27)),
  };
}

function buildRounds(
  company: DummyCompany,
  cycle: Cycle,
  schedule: Schedule,
): OfferInputValues["rounds"] {
  const headline = company.ctcLpa ?? 10;
  const base = headline >= 20 ? 4 : headline >= 8 ? 3 : 2;
  const count = clamp(base + int(-1, 0), 1, 4);
  const difficulty = clamp(Math.round(headline / 12) + int(0, 1), 1, 5);

  const kinds: Array<OfferInputValues["rounds"][number]["kind"]> = [
    "ONLINE_ASSESSMENT",
    "TECHNICAL_INTERVIEW",
    cycle === "FULL_TIME" && headline >= 25 ? "SYSTEM_DESIGN" : "MANAGERIAL",
    "HR",
  ];

  return kinds.slice(0, count).map((kind, index) => ({
    kind,
    mode: index === 0 ? "ONLINE" : company.workMode === "REMOTE" ? "ONLINE" : "IN_PERSON",
    heldOn: schedule.rounds[Math.min(index, schedule.rounds.length - 1)],
    difficulty: clamp(difficulty + (index === 0 ? 0 : 1) - int(0, 1), 1, 5),
    topics: index === 0 ? pick(TOPIC_SETS) : random() < 0.5 ? pick(TOPIC_SETS) : undefined,
  }));
}

function buildComponents(
  ctcLpa: number,
  company: DummyCompany,
): OfferInputValues["components"] {
  const base = round(ctcLpa * company.baseRatio, 1);
  const components: OfferInputValues["components"] = [
    { kind: "FIXED_BASE", amountLpa: base, isOneTime: false },
  ];

  let remaining = round(ctcLpa - base, 1);
  if (remaining <= 0) return components;

  if (ctcLpa >= 20) {
    const equity = round(remaining * 0.55, 1);
    components.push({
      kind: random() < 0.5 ? "RSU" : "ESOP",
      amountLpa: equity,
      isOneTime: false,
      note: "Vests over four years.",
    });
    remaining = round(remaining - equity, 1);
  }

  if (remaining > 1) {
    const variable = round(remaining * 0.5, 1);
    components.push({ kind: "VARIABLE_PAY", amountLpa: variable, isOneTime: false });
    remaining = round(remaining - variable, 1);
  }

  if (remaining > 0.4) {
    components.push({
      kind: random() < 0.7 ? "JOINING_BONUS" : "RELOCATION",
      amountLpa: remaining,
      isOneTime: true,
    });
  }

  return components;
}

/**
 * CGPA rises with the package but not cleanly. The noise is the point: a
 * dataset where CGPA predicts CTC perfectly would make the regression on the
 * analysis page a straight line and tell a student something false.
 */
function cgpaFor(headlineLpa: number): number {
  const trend = 7.05 + clamp(headlineLpa, 0, 60) * 0.042;
  return round(clamp(trend + jitter() * 0.8, 6.0, 9.9), 2);
}

function buildOffer(
  company: DummyCompany,
  cycle: Cycle,
  outlier: "high" | "low" | null,
  /**
   * The first person to name a company decides how it is spelled forever, so
   * the first submission always types the canonical name and everyone after it
   * types whatever they type. Otherwise a company row ends up titled "cobalt
   * systems" because of the order the shuffle happened to produce.
   */
  firstMention: boolean,
): { typed: string; offer: Omit<OfferInputValues, "batchYear"> } {
  const typed =
    firstMention || !company.spellings ? company.name : pick(company.spellings);
  const schedule = scheduleFor(company);
  const isFullTime = cycle === "FULL_TIME";

  // Individual reports of the same drive disagree slightly, the way memory
  // does. Kept inside ±8% so corroboration still finds a majority.
  const spread = 1 + jitter() * 0.08;
  let ctcLpa: number | undefined;
  if (isFullTime && company.ctcLpa !== null) {
    const multiplier = outlier ? OUTLIER_MULTIPLIER[outlier] : spread;
    ctcLpa = round(company.ctcLpa * multiplier, 1);
  }

  const stipend =
    !isFullTime && company.stipendPerMonthInr !== null
      ? Math.round((company.stipendPerMonthInr * (1 + jitter() * 0.12)) / 1000) * 1000
      : undefined;

  const headlineForCgpa = ctcLpa ?? (stipend ? (stipend * 12) / 100_000 : 8);

  const acceptanceRoll = random();
  const acceptanceStatus: OfferInputValues["acceptanceStatus"] =
    acceptanceRoll < 0.72
      ? "ACCEPTED"
      : acceptanceRoll < 0.88
        ? "DECLINED"
        : acceptanceRoll < 0.97
          ? "PENDING"
          : "REVOKED";

  return {
    typed,
    offer: {
      companyName: typed,
      roleTitle: isFullTime ? pick(company.titles) : company.internTitle,
      roleFamily: company.roleFamily,
      cycle,
      nature: isFullTime
        ? random() < 0.15
          ? "PPO_CONVERTED"
          : "FTE_ONLY"
        : cycle === "SIX_MONTH_INTERNSHIP"
          ? "INTERNSHIP_PLUS_FTE"
          : "INTERNSHIP_ONLY",

      ctcLpa,
      baseLpa: ctcLpa !== undefined ? round(ctcLpa * company.baseRatio, 1) : undefined,
      stipendPerMonthInr: stipend,
      components: ctcLpa !== undefined ? buildComponents(ctcLpa, company) : [],

      cgpa: cgpaFor(headlineForCgpa),
      backlogsAtOffer: random() < 0.08 ? int(1, 2) : 0,
      priorInternshipCount: random() < 0.55 ? int(1, 3) : 0,

      locations: company.locations.slice(0, 1 + (random() < 0.4 ? 1 : 0)),
      workMode: company.workMode,
      bondMonths: company.bondMonths,
      internshipDurationMonths:
        cycle === "SIX_MONTH_INTERNSHIP" ? 6 : cycle === "SUMMER_INTERNSHIP" ? 2 : undefined,

      // Students remember the announced bar slightly differently, so the
      // company profile has to take a median rather than the loudest report.
      announcedCgpaCutoff:
        company.announcedCgpaCutoff === null
          ? undefined
          : round(company.announcedCgpaCutoff + pick([-0.5, 0, 0, 0, 0.5]), 1),
      eligibleBranches: company.eligibleBranches,

      offerDate: schedule.offerDate,
      acceptanceStatus,

      processNotes: random() < 0.45 ? pick(PROCESS_NOTES) : undefined,
      preparationResources: random() < 0.3 ? pick(PREP_NOTES) : undefined,
      difficultyRating: random() < 0.7 ? int(1, 5) : undefined,

      // Anonymity is the default and must visibly stay the majority.
      showName: random() < 0.12,

      rounds: buildRounds(company, cycle, schedule),
    },
  };
}

/**
 * Assigns planned offers to students without ever exceeding what the submission
 * policy allows — one summer internship, three six-month internships, three
 * full-time offers and only one per tier. The runner re-checks all of this
 * against the database anyway; getting it right here is what keeps the run from
 * being mostly rejections.
 */
function assign(plans: Plan[]): DummySubmission[] {
  type Usage = { summer: number; sixMonth: number; fullTime: number; tiers: Set<string> };
  const usage: Usage[] = STUDENTS.map(() => ({
    summer: 0,
    sixMonth: 0,
    fullTime: 0,
    tiers: new Set<string>(),
  }));

  /**
   * The tier the server will derive, which for an outlier row is NOT the tier
   * its company usually lands in — a package inflated to 2.4× moves up a band.
   * Booking the wrong tier here would hand a student two offers in one tier and
   * the quota check would reject the second, so this reads the effective figure.
   */
  const tierOf = (plan: Plan): string => {
    if (plan.company.ctcLpa === null || plan.cycle !== "FULL_TIME") return "NONE";
    const effective =
      plan.company.ctcLpa * (plan.outlier ? OUTLIER_MULTIPLIER[plan.outlier] : 1);
    if (effective >= 12) return "TIER_1";
    if (effective >= 6) return "TIER_2";
    return "TIER_3";
  };

  const fits = (index: number, plan: Plan): boolean => {
    const use = usage[index]!;
    if (plan.cycle === "SUMMER_INTERNSHIP") return use.summer < 1;
    if (plan.cycle === "SIX_MONTH_INTERNSHIP") return use.sixMonth < 3;
    return use.fullTime < 3 && !use.tiers.has(tierOf(plan));
  };

  const take = (index: number, plan: Plan): void => {
    const use = usage[index]!;
    if (plan.cycle === "SUMMER_INTERNSHIP") use.summer += 1;
    else if (plan.cycle === "SIX_MONTH_INTERNSHIP") use.sixMonth += 1;
    else {
      use.fullTime += 1;
      use.tiers.add(tierOf(plan));
    }
  };

  const total = (index: number): number => {
    const use = usage[index]!;
    return use.summer + use.sixMonth + use.fullTime;
  };

  const mentioned = new Set<string>();
  const submissions: DummySubmission[] = [];

  /**
   * A company that told the campus it wanted three branches should not turn up
   * having hired from a fourth. The branch table sets "called for" beside
   * "offers received" precisely so that gap can be read, and it says nothing at
   * all if the offers were dealt out irrespective of eligibility.
   */
  const calledFor = (index: number, plan: Plan): boolean =>
    plan.company.eligibleBranches.includes(STUDENTS[index]!.branchCode);

  for (const [planIndex, plan] of plans.entries()) {
    // Everyone files something before anyone files twice, then the surplus goes
    // to whoever the policy still has room for.
    const byLoad = [0, 1, 2].map((load) =>
      STUDENTS.map((_student, index) => index).filter((index) => total(index) === load),
    );

    const candidates =
      byLoad.find((group) => group.some((index) => fits(index, plan) && calledFor(index, plan))) ??
      byLoad.find((group) => group.some((index) => fits(index, plan)));

    if (!candidates) {
      throw new Error(`No student can accept plan ${planIndex} (${plan.company.name}).`);
    }

    const preferred = candidates.filter(
      (index) => fits(index, plan) && calledFor(index, plan),
    );
    const eligible = preferred.length > 0 ? preferred : candidates.filter((index) => fits(index, plan));
    const student = eligible[Math.floor(random() * eligible.length)]!;
    take(student, plan);

    const firstMention = !mentioned.has(plan.company.name);
    mentioned.add(plan.company.name);

    const built = buildOffer(plan.company, plan.cycle, plan.outlier, firstMention);
    submissions.push({
      student,
      typedCompanyName: built.typed,
      outlier: plan.outlier,
      offer: built.offer,
    });
  }

  return submissions;
}

function buildPlans(): Plan[] {
  const plans: Plan[] = [];
  for (const company of COMPANIES) {
    for (let i = 0; i < company.hires.fullTime; i += 1) {
      plans.push({ company, cycle: "FULL_TIME", outlier: null });
    }
    for (let i = 0; i < company.hires.sixMonth; i += 1) {
      plans.push({ company, cycle: "SIX_MONTH_INTERNSHIP", outlier: null });
    }
    for (let i = 0; i < company.hires.summer; i += 1) {
      plans.push({ company, cycle: "SUMMER_INTERNSHIP", outlier: null });
    }
  }

  // Interleave so submissions arrive in a plausible order rather than company
  // by company — corroboration and outlier detection both depend on what is
  // already on file when a row lands, so the order is part of the test.
  for (let i = plans.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [plans[i], plans[j]] = [plans[j]!, plans[i]!];
  }

  // The two implausible figures go on the LAST report from the two most
  // crowded drives. The detector needs at least three peers already on file
  // before it will compare anything, so an outlier that arrives first is not an
  // outlier — it is the median.
  const lastFullTimeIndex = (name: string): number => {
    let found = -1;
    plans.forEach((plan, index) => {
      if (plan.cycle === "FULL_TIME" && plan.company.name === name) found = index;
    });
    return found;
  };

  const high = lastFullTimeIndex("Cobalt Systems");
  const low = lastFullTimeIndex("Pinegrove Services");
  if (high >= 0) plans[high]!.outlier = "high";
  if (low >= 0) plans[low]!.outlier = "low";

  return plans;
}

export const SUBMISSIONS: DummySubmission[] = assign(buildPlans());

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type DummyReport = {
  /** Index into STUDENTS — never the student who filed the offer. */
  reporter: number;
  /** Index into SUBMISSIONS. */
  submission: number;
  reason: "INFLATED_CTC" | "FAKE_OFFER" | "WRONG_COMPANY" | "DUPLICATE" | "OTHER";
  details: string;
};

/**
 * Reports are filed against the two outliers and a couple of ordinary rows, so
 * the admin queue has something in it and the disputed path is exercised. Two
 * independent reports on one offer is the threshold at which it stops being
 * shown as settled, so the first offer gets exactly that.
 */
function buildReports(): DummyReport[] {
  const reports: DummyReport[] = [];

  /** Anyone but the person who filed it — reporting your own entry is refused. */
  const pickReporter = (avoid: number): number => {
    let candidate = int(0, STUDENTS.length - 1);
    while (candidate === avoid) candidate = int(0, STUDENTS.length - 1);
    return candidate;
  };

  const highIndex = SUBMISSIONS.findIndex((submission) => submission.outlier === "high");
  const lowIndex = SUBMISSIONS.findIndex((submission) => submission.outlier === "low");

  if (highIndex >= 0) {
    // Two independent reporters on one offer: the threshold at which it stops
    // being shown as settled.
    reports.push({
      reporter: pickReporter(SUBMISSIONS[highIndex]!.student),
      submission: highIndex,
      reason: "INFLATED_CTC",
      details: "This is more than twice what everyone else from the same drive reported.",
    });
    reports.push({
      reporter: pickReporter(SUBMISSIONS[highIndex]!.student),
      submission: highIndex,
      reason: "FAKE_OFFER",
      details: "Nobody in the batch has heard of this package at this company.",
    });
  }

  if (lowIndex >= 0) {
    reports.push({
      reporter: pickReporter(SUBMISSIONS[lowIndex]!.student),
      submission: lowIndex,
      reason: "WRONG_COMPANY",
      details: "The package quoted is far below what this company offered anyone else.",
    });
  }

  // A few ordinary rows, so the queue is not made only of extremes.
  for (const index of [12, 47, 91]) {
    const entry = SUBMISSIONS[index];
    if (!entry) continue;
    reports.push({
      reporter: pickReporter(entry.student),
      submission: index,
      reason: index % 2 === 0 ? "DUPLICATE" : "OTHER",
      details: "Looks like the same offer that is already on the board.",
    });
  }

  return reports;
}

export const REPORTS: DummyReport[] = buildReports();
