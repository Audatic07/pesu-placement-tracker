import { describe, expect, it } from "vitest";
import { BASE_ABOVE_CTC, parseOfferForm } from "@/lib/offers/schema";
import { isValidatedField, validateField } from "@/lib/offers/validate";

/**
 * The live validator judges one field at a time against the same schema the
 * posted form is validated with. These pin the two things that matter: that
 * a field it flags is one the server would refuse, in the same words, and that
 * a blank field is "not given" rather than an error — the decoder's rule.
 */

function posted(fields: Record<string, string>): ReturnType<typeof parseOfferForm> {
  const form = new FormData();
  form.set("batchYear", "2027");
  form.set("companyName", "Acme");
  form.set("roleTitle", "SDE");
  form.set("cycle", "FULL_TIME");
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return parseOfferForm(form);
}

describe("validateField", () => {
  it("says the same thing the server would, for the same value", () => {
    const live = validateField("cgpa", "11");
    const server = posted({ cgpa: "11" });

    expect(live).toBe("A CGPA is out of 10.");
    expect(server.success).toBe(false);
    expect(server.success ? null : server.error.issues[0]?.message).toBe(live);
  });

  it("treats a blank field as not given, never as zero or as an error", () => {
    expect(validateField("cgpa", "")).toBeNull();
    expect(validateField("ctcLpa", "   ")).toBeNull();
    expect(validateField("componentAmount", "")).toBeNull();
  });

  it("accepts what the schema accepts", () => {
    expect(validateField("cgpa", "8.75")).toBeNull();
    expect(validateField("ctcLpa", "18.5")).toBeNull();
    expect(validateField("backlogsAtOffer", "0")).toBeNull();
    expect(validateField("companyName", "Acme")).toBeNull();
  });

  it("flags a required text field left blank, in the form's own words", () => {
    expect(validateField("companyName", "")).toBe("Which company?");
    expect(validateField("roleTitle", "  ")).toBe("What was the role called?");
  });

  it("flags a whole-number field given a fraction", () => {
    expect(validateField("backlogsAtOffer", "1.5")).toBe("Backlogs are a whole number.");
  });

  it("judges the base against the CTC, exactly as the posted form is judged", () => {
    expect(validateField("baseLpa", "20", { ctcLpa: "18" })).toBe(BASE_ABOVE_CTC);
    expect(validateField("baseLpa", "12", { ctcLpa: "18" })).toBeNull();
    // No CTC to compare against: nothing to say.
    expect(validateField("baseLpa", "20", {})).toBeNull();

    const server = posted({ ctcLpa: "18", baseLpa: "20" });
    expect(server.success).toBe(false);
    expect(server.success ? null : server.error.issues[0]?.path).toEqual(["baseLpa"]);
    expect(server.success ? null : server.error.issues[0]?.message).toBe(BASE_ABOVE_CTC);
  });

  it("flags a repeated row's amount by the same rule as a posted component", () => {
    expect(validateField("componentAmount", "-1")).toBe("An amount cannot be negative.");
  });

  it("knows which posted names it can judge", () => {
    expect(isValidatedField("cgpa")).toBe(true);
    expect(isValidatedField("componentAmount")).toBe(true);
    // Selects only ever post one of their options; nothing to judge live.
    expect(isValidatedField("cycle")).toBe(false);
    expect(isValidatedField("batchYear")).toBe(false);
  });
});
