import { describe, expect, it } from "vitest";
import { parseGpaCutoff } from "./gpa";
import {
  buildKnownAliasIndex,
  cleanCompanyName,
  normalizeCompanyName,
  similarityKey,
  slugify,
} from "./companies";
import {
  classifyRoleFamily,
  natureFromHeadcounts,
  parseBondMonths,
  parseEligibleBranches,
  parseInternshipMonths,
  parseLocations,
  parseWorkMode,
  refineNatureFromNote,
} from "./roles";

describe("parseGpaCutoff — real cutoff cells", () => {
  it("reads a plain number as a hard bar", () => {
    const result = parseGpaCutoff(9);
    expect(result.numeric).toBe(9);
    expect(result.kind).toBe("STRICT");
  });

  it("Eternal's '8(+ Resume)' is a bar the resume can override", () => {
    const result = parseGpaCutoff("8(+ Resume)");
    expect(result.numeric).toBe(8);
    expect(result.kind).toBe("MIXED");
  });

  it("Couchbase's 'Resume Based' has no numeric bar", () => {
    const result = parseGpaCutoff("Resume Based");
    expect(result.numeric).toBeNull();
    expect(result.kind).toBe("RESUME_BASED");
  });

  it("Cloudera's board-marks condition does not become the CGPA", () => {
    // "8.91 + (10th &12th > 90)" — 90 is a percentage, not a CGPA.
    const result = parseGpaCutoff("8.91 + (10th &12th > 90)");
    expect(result.numeric).toBe(8.91);
  });

  it("Eternal 2027's '7 (Mostly Resume Based and 8.5+)' is mixed, not strict", () => {
    const result = parseGpaCutoff("7 (Mostly Resume Based and 8.5+)");
    expect(result.numeric).toBe(7);
    expect(result.kind).toBe("MIXED");
  });

  it("Lam Research's per-branch bar is flagged as branch specific", () => {
    const result = parseGpaCutoff("6.8 (9 for CSE/AIML)");
    expect(result.numeric).toBe(6.8);
    expect(result.isBranchSpecific).toBe(true);
    expect(result.kind).toBe("MIXED");
  });

  it("ignores a student count and finds the real cutoff", () => {
    const result = parseGpaCutoff(
      "Shortlisted(102 students) 8.5 + CGPA with Excellent projects / open source contributions.",
    );
    expect(result.numeric).toBe(8.5);
    expect(result.kind).toBe("MIXED");
  });

  it("treats N/A as explicitly open", () => {
    expect(parseGpaCutoff("N/A").kind).toBe("NONE");
  });

  it("returns UNKNOWN for a blank cell", () => {
    expect(parseGpaCutoff(null).kind).toBe("UNKNOWN");
  });

  it("always keeps the raw text", () => {
    expect(parseGpaCutoff("8(+ Resume)").raw).toBe("8(+ Resume)");
  });
});

describe("company identity", () => {
  it("normalises away punctuation and spacing only", () => {
    expect(normalizeCompanyName("Oracle(OFSS)")).toBe(normalizeCompanyName("Oracle (OFSS)"));
    expect(normalizeCompanyName("HCL Tech")).toBe(normalizeCompanyName("HCLTech"));
  });

  it("keeps genuinely different arms distinct", () => {
    expect(normalizeCompanyName("IBM (ISL)")).not.toBe(normalizeCompanyName("IBM (ISDL)"));
  });

  it("similarityKey strips legal suffixes so near-duplicates can be suggested", () => {
    expect(similarityKey("Mysa Innovations Pvt Ltd")).toBe("mysainnovations");
    expect(similarityKey("Rubrik India Pvt. Ltd")).toBe("rubrik");
    expect(similarityKey("IBM (ISL)")).toBe("ibm");
  });

  it("splits a trailing status out of the company name", () => {
    const result = cleanCompanyName("Infosys (DID NOT PROCEED)");
    expect(result.name).toBe("Infosys");
    expect(result.inlineNote).toBe("DID NOT PROCEED");
  });

  it("leaves an ordinary name alone", () => {
    expect(cleanCompanyName("Meesho")).toEqual({ name: "Meesho", inlineNote: null });
  });

  it("resolves declared aliases to one canonical company", () => {
    const index = buildKnownAliasIndex();
    expect(index.get(normalizeCompanyName("Eternal"))?.canonical).toBe("Eternal (Zomato)");
    expect(index.get(normalizeCompanyName("Eternal(Zomato)"))?.canonical).toBe("Eternal (Zomato)");
    expect(index.get(normalizeCompanyName("Zomato"))?.canonical).toBe("Eternal (Zomato)");
  });

  it("hangs subsidiary arms off their parent", () => {
    const index = buildKnownAliasIndex();
    const isl = index.get(normalizeCompanyName("IBM (ISL)"));
    expect(isl?.canonical).toBe("IBM (ISL)");
    expect(isl?.parent).toBe("IBM");
  });

  it("makes readable slugs", () => {
    expect(slugify("Eternal (Zomato)")).toBe("eternal-zomato");
    expect(slugify("D E Shaw")).toBe("d-e-shaw");
    expect(slugify("AT&T")).toBe("at-and-t");
  });
});

describe("classifyRoleFamily", () => {
  it.each([
    ["SDE", "SDE"],
    ["Software Engineer", "SDE"],
    ["SWE", "SDE"],
    ["Associate Application Developer", "SDE"],
    ["Data Scientist", "DATA_SCIENCE"],
    ["AI Analyst", "DATA_SCIENCE"],
    ["Associate Data Engineering", "DATA_ENGINEERING"],
    ["Business Analyst", "ANALYST"],
    ["SDE in Test", "QA_SDET"],
    ["Automation Testing & SDET", "QA_SDET"],
    ["Cybersecurity Analyst", "CYBERSECURITY"],
    ["Site Reliability Engineer", "DEVOPS_SRE"],
    ["Digital Design Engineer", "EMBEDDED_HARDWARE"],
    ["Technical Program Manager", "PRODUCT"],
    ["Business Technology Solutions Associate", "CONSULTING"],
    ["Patent Associate", "NON_TECH"],
  ])("classifies %s as %s", (title, expected) => {
    expect(classifyRoleFamily(title)).toBe(expected);
  });

  it("falls back to OTHER rather than guessing", () => {
    expect(classifyRoleFamily("2 skills met")).toBe("OTHER");
    expect(classifyRoleFamily(null)).toBe("OTHER");
  });
});

describe("offer nature", () => {
  it("reads the sheet's three headcount columns", () => {
    expect(natureFromHeadcounts({ internship: null, fte: 5, both: null })).toBe("FTE_ONLY");
    expect(natureFromHeadcounts({ internship: 10, fte: null, both: null })).toBe("INTERNSHIP_ONLY");
    expect(natureFromHeadcounts({ internship: null, fte: null, both: 3 })).toBe("INTERNSHIP_PLUS_FTE");
    expect(natureFromHeadcounts({ internship: 3, fte: 14, both: null })).toBe("INTERNSHIP_PLUS_FTE");
  });

  it("lets the note correct the headcounts", () => {
    expect(refineNatureFromNote("FTE_ONLY", "Coming only for Internship, conversion based on performance")).toBe(
      "INTERNSHIP_ONLY",
    );
    expect(refineNatureFromNote("INTERNSHIP_ONLY", "FTE Only")).toBe("FTE_ONLY");
    expect(refineNatureFromNote("FTE_ONLY", "Additional 5 lacs medical insurance")).toBe("FTE_ONLY");
  });
});

describe("note extraction", () => {
  it("reads job locations in the sheet's shorthand", () => {
    expect(parseLocations("JL : Blr/Hyd")).toEqual(["Bangalore", "Hyderabad"]);
    expect(parseLocations("Job Location Hyderabad")).toEqual(["Hyderabad"]);
    expect(parseLocations("Location : PAN India")).toEqual(["PAN India"]);
    expect(parseLocations("Job Location is Mumbai")).toEqual(["Mumbai"]);
  });

  it("returns nothing when there is no location", () => {
    expect(parseLocations("Fully remote job")).toEqual([]);
    expect(parseLocations(null)).toEqual([]);
  });

  it("reads work mode", () => {
    expect(parseWorkMode("Fully remote job")).toBe("REMOTE");
    expect(parseWorkMode("Hybrid, 3 days a week")).toBe("HYBRID");
    expect(parseWorkMode("Job Location Hyderabad")).toBe("UNKNOWN");
  });

  it("reads a service bond", () => {
    expect(parseBondMonths("Has a bond of 2.5 yrs")).toBe(30);
    expect(parseBondMonths("bond of 2 years")).toBe(24);
    expect(parseBondMonths("No bond mentioned here")).toBeNull();
  });

  it("reads internship duration", () => {
    expect(parseInternshipMonths("Internship period from 6 - 10 months")).toBe(10);
    expect(parseInternshipMonths("12 month internship")).toBe(12);
    expect(parseInternshipMonths("Internship for 3 months.")).toBe(3);
    expect(parseInternshipMonths("Fully remote job")).toBeNull();
  });

  it("reads eligible branches and rejects anything not a branch", () => {
    expect(parseEligibleBranches("CSE, AIML")).toEqual(["CSE", "AIML"]);
    expect(parseEligibleBranches("CSE, AIML, ECE, EEE, MECH, BT")).toEqual([
      "CSE", "AIML", "ECE", "EEE", "MECH", "BT",
    ]);
    expect(parseEligibleBranches("Open to M.Tech also")).toEqual([]);
    expect(parseEligibleBranches(null)).toEqual([]);
  });
});
