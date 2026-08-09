import { describe, expect, it } from "vitest";
import {
  graduationYearFromSemester,
  graduationYearFromSrn,
  parseSemester,
  parseSrn,
} from "./srn";

describe("parseSrn", () => {
  it("parses a standard RR campus undergraduate SRN", () => {
    expect(parseSrn("PES1UG23CS001")).toEqual({
      campusCode: 1,
      level: "UG",
      admissionYear: 2023,
      branchCode: "CS",
      serial: "001",
    });
  });

  it("parses an EC campus postgraduate SRN", () => {
    expect(parseSrn("PES2PG24EC045")).toEqual({
      campusCode: 2,
      level: "PG",
      admissionYear: 2024,
      branchCode: "EC",
      serial: "045",
    });
  });

  it("accepts lowercase and stray whitespace", () => {
    expect(parseSrn("  pes1ug22am123 ")?.admissionYear).toBe(2022);
  });

  it("handles four-branch-letter codes such as AIML", () => {
    expect(parseSrn("PES1UG23AIML12")?.branchCode).toBe("AIML");
  });

  it("returns null for anything that is not an SRN", () => {
    for (const bad of ["", "PES1UG2CS001", "ABC1UG23CS001", "PES1XX23CS001"]) {
      expect(parseSrn(bad)).toBeNull();
    }
  });
});

describe("graduationYearFromSrn", () => {
  it("adds the programme length to the admission year", () => {
    expect(graduationYearFromSrn("PES1UG23CS001", 4)).toBe(2027);
    expect(graduationYearFromSrn("PES1UG22CS001", 4)).toBe(2026);
    expect(graduationYearFromSrn("PES2PG24CS001", 2)).toBe(2026);
  });

  it("returns null when the SRN is unparseable", () => {
    expect(graduationYearFromSrn("not-an-srn", 4)).toBeNull();
  });
});

describe("graduationYearFromSemester", () => {
  // A 4-year, 8-semester B.Tech. August 2026 is the odd term of the 2026-27
  // academic year; March 2027 is the even term of that same academic year.
  const august2026 = new Date(Date.UTC(2026, 7, 15));
  const march2027 = new Date(Date.UTC(2027, 2, 15));

  it("resolves odd semesters observed in the first half of the year", () => {
    expect(graduationYearFromSemester(7, 8, august2026)).toBe(2027);
    expect(graduationYearFromSemester(5, 8, august2026)).toBe(2028);
    expect(graduationYearFromSemester(3, 8, august2026)).toBe(2029);
    expect(graduationYearFromSemester(1, 8, august2026)).toBe(2030);
  });

  it("resolves even semesters observed in the second half of the year", () => {
    expect(graduationYearFromSemester(8, 8, march2027)).toBe(2027);
    expect(graduationYearFromSemester(6, 8, march2027)).toBe(2028);
    expect(graduationYearFromSemester(4, 8, march2027)).toBe(2029);
    expect(graduationYearFromSemester(2, 8, march2027)).toBe(2030);
  });

  it("agrees with the SRN for the same student", () => {
    // PES1UG23... was admitted in 2023 and is in semester 7 in August 2026.
    expect(graduationYearFromSrn("PES1UG23CS001", 4)).toBe(
      graduationYearFromSemester(7, 8, august2026),
    );
  });

  it("handles a 6-semester programme ending on an odd term", () => {
    expect(graduationYearFromSemester(5, 6, august2026)).toBe(2027);
    expect(graduationYearFromSemester(6, 6, march2027)).toBe(2027);
  });

  it("rejects out-of-range semesters", () => {
    expect(graduationYearFromSemester(0, 8, august2026)).toBeNull();
    expect(graduationYearFromSemester(9, 8, august2026)).toBeNull();
    expect(graduationYearFromSemester(Number.NaN, 8, august2026)).toBeNull();
  });
});

describe("parseSemester", () => {
  it("reads plain digits and prefixed forms", () => {
    expect(parseSemester("5")).toBe(5);
    expect(parseSemester("Sem 7")).toBe(7);
    expect(parseSemester("Semester 3")).toBe(3);
  });

  it("reads roman numerals", () => {
    expect(parseSemester("VII")).toBe(7);
    expect(parseSemester("Sem IV")).toBe(4);
  });

  it("returns null for missing or nonsense input", () => {
    expect(parseSemester(null)).toBeNull();
    expect(parseSemester(undefined)).toBeNull();
    expect(parseSemester("")).toBeNull();
    expect(parseSemester("banana")).toBeNull();
    expect(parseSemester("99")).toBeNull();
  });
});
