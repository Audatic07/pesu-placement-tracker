import { describe, expect, it } from "vitest";
import { parseAmountCell, parseCompensationNote } from "./compensation";

/**
 * Every note in this file is copied verbatim from the source workbooks. If the
 * parser handles these, it handles the corpus it was written for.
 */

function kinds(note: string) {
  return parseCompensationNote(note).components.map((c) => `${c.kind}:${c.amount}${c.currency === "USD" ? "USD" : ""}`);
}

describe("parseCompensationNote — real notes from the 2026 sheet", () => {
  it("Hyperface: 2L joining bonus, 6L ESOP's", () => {
    expect(kinds("2L joining bonus, 6L ESOP's")).toEqual([
      "JOINING_BONUS:2",
      "ESOP:6",
    ]);
  });

  it("Razorpay: ESOPs plus a joining bonus", () => {
    const result = parseCompensationNote(
      "CTC inclusive of ESOPs worth 15 lakhs + 2 Joining Bonus",
    );
    const esop = result.components.find((c) => c.kind === "ESOP");
    const jb = result.components.find((c) => c.kind === "JOINING_BONUS");
    expect(esop?.amount).toBe(15);
    expect(esop?.isCash).toBe(false);
    expect(jb?.amount).toBe(2);
    expect(jb?.isOneTime).toBe(true);
  });

  it("Cloudera: refuses to compute from a unit count and a unit price", () => {
    // "1600 units at 18$" is a share count and a share price. Multiplying them
    // would produce a confident, wrong, unreviewable number — so this goes to
    // a human instead.
    const result = parseCompensationNote(
      "Possible Additional ESOPs (1600 units at 18$ vested 4 years)",
    );
    expect(result.components).toHaveLength(0);
    expect(result.unrecognised[0]).toContain("1600 units at 18$");
  });

  it("Confluent: USD 40000 additional RSU vested over 2 years", () => {
    const result = parseCompensationNote("USD 40000 additional RSU vested over 2 years.");
    const rsu = result.components.find((c) => c.kind === "RSU");
    expect(rsu?.amount).toBe(40000);
    expect(rsu?.currency).toBe("USD");
    expect(rsu?.isLpa).toBe(false);
    expect(rsu?.vestingYears).toBe(2);
  });

  it("AMD: 15000$ RSUs vested 4 years", () => {
    const result = parseCompensationNote("Includes 15000$ RSUs vested 4 years");
    const rsu = result.components.find((c) => c.kind === "RSU");
    expect(rsu?.amount).toBe(15000);
    expect(rsu?.currency).toBe("USD");
    expect(rsu?.vestingYears).toBe(4);
  });

  it("Kickdrum: a fully itemised package", () => {
    const result = parseCompensationNote(
      "10 LPA (Fixed) + 1 Lakh (Variable) + 3 Lakhs (Special Bonus) + 1.73 LPA (Benefits, retirals)",
    );
    const byKind = Object.fromEntries(
      result.components.map((c) => [c.kind, c.amount]),
    );
    expect(byKind["FIXED_BASE"]).toBe(10);
    expect(byKind["VARIABLE_PAY"]).toBe(1);
    expect(byKind["PERKS"]).toBe(1.73);

    // "3 Lakhs (Special Bonus)" has no label this parser recognises. It is real
    // money, so it must be surfaced for a human rather than quietly dropped.
    expect(result.unrecognised.join(" ")).toContain("3 Lakhs");
  });

  it("SAP: separates a joining bonus, vesting RSUs, and non-cash perks", () => {
    const result = parseCompensationNote(
      "3.5L Joining Bonus will be paid in 2 installments over a period of 2 years. " +
        "4L Restricted Stock Units (RSUs) vest quarterly over three years after an initial six-month waiting period, with payouts made quarterly thereafter. " +
        "8L Benefits include - Free Meals provided on campus, Free Transport for office commute, Relocation , Life Events (Birthday Gift), OwnSAP ,Wellness Cover for Employee, Higher Education Policy.",
    );
    const jb = result.components.find((c) => c.kind === "JOINING_BONUS");
    const rsu = result.components.find((c) => c.kind === "RSU");
    const perks = result.components.find((c) => c.kind === "PERKS");

    expect(jb?.amount).toBe(3.5);
    expect(jb?.isOneTime).toBe(true);

    expect(rsu?.amount).toBe(4);
    expect(rsu?.vestingYears).toBe(3);
    expect(rsu?.isCash).toBe(false);

    // 8 lakhs of free lunch is not salary, and this is the whole point.
    expect(perks?.amount).toBe(8);
    expect(perks?.isCash).toBe(false);
  });

  it("Walmart: rupee amounts with Indian digit grouping", () => {
    const result = parseCompensationNote(
      "Joining Bonus: 2,00,000 New Hire RSU's: 4,00,000",
    );
    const jb = result.components.find((c) => c.kind === "JOINING_BONUS");
    const rsu = result.components.find((c) => c.kind === "RSU");
    expect(jb?.amount).toBe(2);
    expect(rsu?.amount).toBe(4);
  });

  it("Walmart, in full: a label with a colon takes the amount after it", () => {
    // The joining bonus is preceded by "Target Total Cash: 2,009,000", which
    // sits marginally closer to the label than its own figure does.
    const result = parseCompensationNote(
      "Annual Fixed Pay: 1,834,000 Target Annual Incentive Amount: 1,75,000 " +
        "Target Total Cash: 2,009,000 Joining Bonus: 2,00,000 New Hire RSU’s: 4,00,000",
    );
    const byKind = Object.fromEntries(result.components.map((c) => [c.kind, c.amount]));

    expect(byKind["FIXED_BASE"]).toBe(18.34);
    expect(byKind["VARIABLE_PAY"]).toBe(1.75);
    expect(byKind["JOINING_BONUS"]).toBe(2);
    expect(byKind["RSU"]).toBe(4);

    // "Target Total Cash" restates base + variable and belongs to no component,
    // so it must be surfaced rather than silently attributed.
    expect(result.unrecognised.join(" ")).toContain("2,009,000");
  });

  it("Netradyne: notes a component it cannot quantify rather than inventing one", () => {
    const result = parseCompensationNote("Has Retention Bonus");
    expect(result.components).toHaveLength(0);
    expect(result.unrecognised).toContain("Has Retention Bonus");
  });

  it("Meesho: does not read a duration as an amount", () => {
    // "over a period of 4-5 years" describes when the money arrives, not how
    // much. Reading the 4 as four lakhs inflated Meesho's first-year cash.
    const result = parseCompensationNote(
      "All the extra money in CTC is majorly retention bonus over a period of 4-5 years",
    );
    expect(result.components).toHaveLength(0);
    expect(result.unrecognised).toHaveLength(1);
  });

  it("does not read a vesting period as an amount", () => {
    const result = parseCompensationNote("ESOPs vested over 4 years");
    expect(result.components.filter((c) => c.amount === 4)).toHaveLength(0);
  });

  it("ignores prose with no money in it", () => {
    const result = parseCompensationNote("Fully remote job");
    expect(result.components).toHaveLength(0);
  });

  it("returns nothing for an empty note", () => {
    expect(parseCompensationNote(null).components).toHaveLength(0);
    expect(parseCompensationNote("  ").components).toHaveLength(0);
  });
});

describe("parseAmountCell — the messy compensation cells", () => {
  it("reads a plain number", () => {
    expect(parseAmountCell(24).value).toBe(24);
    expect(parseAmountCell(15.23).value).toBe(15.23);
  });

  it("reads Infosys's '10 (+1)' as ten with one extra", () => {
    const result = parseAmountCell("10 (+1)");
    expect(result.value).toBe(10);
    expect(result.additional).toBe(1);
  });

  it("reads '6.25 (+ 0.75)'", () => {
    const result = parseAmountCell("6.25 (+ 0.75)");
    expect(result.value).toBe(6.25);
    expect(result.additional).toBe(0.75);
  });

  it("keeps the qualifier on Arctic Wolf's '21 (Only on conversion)'", () => {
    const result = parseAmountCell("21 (Only on conversion)");
    expect(result.value).toBe(21);
    expect(result.qualifier).toBe("(Only on conversion)");
  });

  it("recognises PBC as performance-based rather than as a missing value", () => {
    const result = parseAmountCell("PBC");
    expect(result.isPerformanceBased).toBe(true);
    expect(result.value).toBeNull();
  });

  it("recognises an undisclosed package", () => {
    expect(parseAmountCell("(Not disclosed)").isUndisclosed).toBe(true);
    expect(parseAmountCell("TBD").isUndisclosed).toBe(true);
  });

  it("treats a dash and a blank as no value, not as zero", () => {
    expect(parseAmountCell("-").value).toBeNull();
    expect(parseAmountCell(null).value).toBeNull();
    expect(parseAmountCell("").value).toBeNull();
  });

  it("keeps 'Base + PF + ESOPs' as a qualifier instead of parsing a number", () => {
    const result = parseAmountCell("Base + PF + ESOPs");
    expect(result.value).toBeNull();
    expect(result.qualifier).toBe("Base + PF + ESOPs");
  });
});
