import { describe, expect, it } from "vitest";
import { parseOfferForm } from "@/lib/offers/submit";

/**
 * The form decoder.
 *
 * Everything here is a rule about the *wire format* rather than about the
 * schema: what a browser actually posts when a field is left blank, when a
 * checkbox is not ticked, and when the same input name appears several times.
 * Those are the places a decoder silently turns "" into 0 or drops the second
 * component, and the schema cannot catch either — a 0 is a valid number and a
 * shorter array is a valid array.
 */

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const item of value) data.append(key, item);
    else data.set(key, value);
  }
  return data;
}

const MINIMUM = {
  batchYear: "2027",
  companyName: "Northwind Labs",
  roleTitle: "SDE 1",
  cycle: "FULL_TIME",
};

describe("parseOfferForm", () => {
  it("accepts the minimum a student can submit", () => {
    const parsed = parseOfferForm(form(MINIMUM));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.companyName).toBe("Northwind Labs");
    expect(parsed.data.batchYear).toBe(2027);
  });

  it("treats a blank numeric field as absent, not as zero", () => {
    const parsed = parseOfferForm(form({ ...MINIMUM, ctcLpa: "", cgpa: "   " }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // A package of 0 would be derived a tier and counted in every median.
    expect(parsed.data.ctcLpa).toBeUndefined();
    expect(parsed.data.cgpa).toBeUndefined();
  });

  it("defaults to anonymous when the checkbox is absent", () => {
    expect(parseOfferForm(form(MINIMUM)).data?.showName).toBe(false);
    expect(parseOfferForm(form({ ...MINIMUM, showName: "on" })).data?.showName).toBe(true);
    // Anything other than the browser's own "on" is not consent.
    expect(parseOfferForm(form({ ...MINIMUM, showName: "false" })).data?.showName).toBe(false);
  });

  it("zips parallel component arrays back into objects", () => {
    const parsed = parseOfferForm(
      form({
        ...MINIMUM,
        componentKind: ["FIXED_BASE", "RSU", "JOINING_BONUS"],
        componentAmount: ["20", "15", "4"],
        componentOneTime: ["false", "false", "true"],
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.components).toEqual([
      { kind: "FIXED_BASE", amountLpa: 20, isOneTime: false },
      { kind: "RSU", amountLpa: 15, isOneTime: false },
      { kind: "JOINING_BONUS", amountLpa: 4, isOneTime: true },
    ]);
  });

  it("drops component rows the student left empty", () => {
    // The form renders spare rows; an untouched one posts a kind with no amount.
    const parsed = parseOfferForm(
      form({
        ...MINIMUM,
        componentKind: ["FIXED_BASE", "VARIABLE_PAY"],
        componentAmount: ["20", ""],
        componentOneTime: ["false", "false"],
      }),
    );
    expect(parsed.data?.components).toHaveLength(1);
  });

  it("splits locations on commas and trims them", () => {
    const parsed = parseOfferForm(
      form({ ...MINIMUM, locations: " Bangalore ,Hyderabad,  , Pune " }),
    );
    expect(parsed.data?.locations).toEqual(["Bangalore", "Hyderabad", "Pune"]);
  });

  it("keeps repeated eligible-branch checkboxes as a list", () => {
    const parsed = parseOfferForm(
      form({ ...MINIMUM, eligibleBranches: ["CSE", "AIML", "ECE"] }),
    );
    expect(parsed.data?.eligibleBranches).toEqual(["CSE", "AIML", "ECE"]);
  });

  it("zips rounds and drops the ones with no kind chosen", () => {
    const parsed = parseOfferForm(
      form({
        ...MINIMUM,
        roundKind: ["ONLINE_ASSESSMENT", "", "HR"],
        roundMode: ["ONLINE", "", ""],
        roundDifficulty: ["4", "", ""],
        roundTopics: ["DP, graphs", "", ""],
        roundHeldOn: ["2026-08-12", "", ""],
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.rounds).toHaveLength(2);
    expect(parsed.data.rounds[0]).toMatchObject({
      kind: "ONLINE_ASSESSMENT",
      mode: "ONLINE",
      difficulty: 4,
      topics: "DP, graphs",
      heldOn: "2026-08-12",
    });
    // A round with no mode chosen is unknown, not invalid.
    expect(parsed.data.rounds[1]).toMatchObject({ kind: "HR", mode: "UNKNOWN" });
  });

  it("reports which field failed, so the form can point at it", () => {
    const parsed = parseOfferForm(form({ ...MINIMUM, companyName: "  " }));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path[0]).toBe("companyName");
  });

  it("rejects a cycle the form did not offer", () => {
    const parsed = parseOfferForm(form({ ...MINIMUM, cycle: "SABBATICAL" }));
    expect(parsed.success).toBe(false);
  });
});
