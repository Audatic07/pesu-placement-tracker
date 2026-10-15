import { describe, expect, it } from "vitest";
import { historicalSourceQuote } from "./source-quote";

const offer = {
  id: `handmade-${"a".repeat(32)}`, source: "OFFICIAL_IMPORT", studentId: null,
  processNotes: "Source: source.xlsx · Internship · row 6.\nAnonymous outcome.",
  compensation: { rawNote: "Source package: monthly internship stipend 105000 INR; stated base 21 LPA; headline CTC 87 LPA.\nPerformance-based FTE." },
};

describe("historical source quotes", () => {
  it("recovers prospective compensation without overwriting the package", () => {
    expect(historicalSourceQuote(offer)).toEqual({ baseLpa: 21, ctcLpa: 87 });
    expect(offer.compensation.rawNote).toContain("Performance-based FTE");
  });
  it("keeps unknown figures unknown and accepts precise decimals", () => {
    expect(historicalSourceQuote({ ...offer, compensation: { rawNote: "Source package: monthly internship stipend unknown INR; stated base unknown LPA; headline CTC 18.5 LPA." } })).toEqual({ baseLpa: null, ctcLpa: 18.5 });
    expect(historicalSourceQuote({ ...offer, compensation: { rawNote: "Source package: monthly internship stipend 50000 INR; stated base unknown LPA; headline CTC unknown LPA." } })).toBeNull();
  });
  it.each(["SELF_REPORTED", "ADMIN_ENTERED"])("does not reinterpret %s submissions", (source) => {
    expect(historicalSourceQuote({ ...offer, source })).toBeNull();
  });
  it("requires anonymous archive provenance", () => {
    expect(historicalSourceQuote({ ...offer, studentId: "student" })).toBeNull();
    expect(historicalSourceQuote({ ...offer, id: "ordinary-offer" })).toBeNull();
    expect(historicalSourceQuote({ ...offer, processNotes: null })).toBeNull();
  });
  it.each(["18-22", "18,5", "2026-01-01", "Infinity", "-5", "10001"])("refuses ambiguous or invalid CTC %s", (ctc) => {
    expect(historicalSourceQuote({ ...offer, compensation: { rawNote: `Source package: monthly internship stipend unknown INR; stated base unknown LPA; headline CTC ${ctc} LPA.` } })).toBeNull();
  });
});
