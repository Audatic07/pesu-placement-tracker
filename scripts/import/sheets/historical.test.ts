import { describe, expect, it } from "vitest";
import { parseStipendCell } from "./historical";

/**
 * The stipend column is rupees PER MONTH in every one of these workbooks, and
 * the field it fills says so in its name. These pin the shorthand the sheets
 * actually use, and the one piece of shorthand that has to be refused.
 */
describe("parseStipendCell", () => {
  it("reads plain rupee figures, with or without separators", () => {
    expect(parseStipendCell(80000)).toBe(80_000);
    expect(parseStipendCell("125000")).toBe(125_000);
    expect(parseStipendCell("50,000")).toBe(50_000);
  });

  it("expands the lakh and thousand shorthand", () => {
    expect(parseStipendCell("1L")).toBe(100_000);
    expect(parseStipendCell("1.5 lakh")).toBe(150_000);
    expect(parseStipendCell("35k")).toBe(35_000);
  });

  it("takes the lower end of a range, because that is the figure guaranteed", () => {
    expect(parseStipendCell("15k-20k")).toBe(15_000);
  });

  it("refuses an annual figure rather than reading it as a monthly one", () => {
    // "12 LPA" is a package, not a stipend. Multiplying it as a lakh figure
    // made it 1,200,000 a month; dropping the unit would make it twelve rupees.
    expect(parseStipendCell("12 LPA")).toBeNull();
    expect(parseStipendCell("4.5lpa")).toBeNull();
  });

  it("treats blank and dash as unknown", () => {
    expect(parseStipendCell(null)).toBeNull();
    expect(parseStipendCell("")).toBeNull();
    expect(parseStipendCell("-")).toBeNull();
    expect(parseStipendCell("--")).toBeNull();
  });
});
