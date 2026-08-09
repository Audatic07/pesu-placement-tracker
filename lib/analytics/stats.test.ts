import { describe, expect, it } from "vitest";
import {
  histogram,
  linearRegression,
  mean,
  median,
  percentile,
  standardDeviation,
} from "./stats";
import { cgpaBand, canShowName, gate, reveal, suppress } from "@/lib/privacy/gate";
import { deriveCompensation, incomeTaxInr, type TaxRegime } from "@/lib/comp/model";

describe("basic statistics", () => {
  it("computes mean and median", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3])).toBe(2);
  });

  it("returns null rather than NaN for an empty set", () => {
    expect(mean([])).toBeNull();
    expect(median([])).toBeNull();
    expect(standardDeviation([5])).toBeNull();
  });

  it("reproduces the source sheet's Tier 3 average and median", () => {
    // Independently verified during the import: the Tier 3 tab's own
    // AVERAGE(F3:F89) is 4.615769230769231 over 26 values.
    const tier3 = [
      4.05, 5, 4.5, 3.93, 4.5, 3.16, 5, 4.58, 4.5, 4.5, 4.5, 6, 5, 3.25, 4.5,
      5.84, 5.5, 3.5, 5.5, 5, 5.5, 5.2, 4, 5, 4.5, 3.5,
    ];
    expect(tier3).toHaveLength(26);
    expect(mean(tier3)).toBeCloseTo(4.615769230769231, 10);
    expect(median(tier3)).toBe(4.5);
  });

  it("computes percentiles by linear interpolation", () => {
    const values = [1, 2, 3, 4, 5];
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 0.5)).toBe(3);
    expect(percentile(values, 1)).toBe(5);
    expect(percentile(values, 0.25)).toBe(2);
    expect(percentile([1, 2], 0.5)).toBe(1.5);
  });
});


describe("linearRegression", () => {
  it("recovers a known line", () => {
    const points = [1, 2, 3, 4, 5].map((x) => ({ x, y: 3 * x + 2 }));
    const fit = linearRegression(points)!;
    expect(fit.slope).toBeCloseTo(3, 10);
    expect(fit.intercept).toBeCloseTo(2, 10);
    expect(fit.rSquared).toBeCloseTo(1, 10);
  });

  it("reports a weak fit as a low r-squared rather than hiding it", () => {
    const points = [
      { x: 1, y: 5 }, { x: 2, y: 1 }, { x: 3, y: 9 },
      { x: 4, y: 2 }, { x: 5, y: 7 },
    ];
    const fit = linearRegression(points)!;
    expect(fit.rSquared).toBeLessThan(0.3);
  });

  it("refuses to fit too few points", () => {
    expect(linearRegression([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
  });
});

describe("histogram", () => {
  it("buckets values on the correct side of a boundary", () => {
    const buckets = histogram([0, 5, 9.99, 10, 15], 10);
    expect(buckets[0]?.count).toBe(3);
    expect(buckets[1]?.count).toBe(2);
  });
});

describe("privacy gate", () => {
  it("suppresses a cohort below the minimum", () => {
    const result = gate(3, () => 42, 5);
    expect(result.suppressed).toBe(true);
    if (result.suppressed) {
      expect(result.cohortSize).toBe(3);
      expect(result.reason).toMatch(/at least 5/i);
    }
  });

  it("reveals a cohort at or above the minimum", () => {
    const result = gate(5, () => 42, 5);
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) expect(result.value).toBe(42);
  });

  it("does not run the computation when suppressing", () => {
    let called = false;
    gate(1, () => {
      called = true;
      return 0;
    }, 5);
    expect(called).toBe(false);
  });

  it("explains an empty cohort differently from a small one", () => {
    expect(suppress(0, 5).reason).toMatch(/no records/i);
    expect(suppress(2, 5).reason).toMatch(/only 2 records/i);
  });

  it("reveals cohort size but never the value when suppressed", () => {
    const result = suppress(4, 5);
    expect(Object.values(result)).not.toContain(42);
    expect(result.cohortSize).toBe(4);
  });

  it("wraps a revealed value with its cohort size", () => {
    expect(reveal(7, 12)).toEqual({ suppressed: false, value: 7, cohortSize: 12 });
  });
});

describe("cgpaBand", () => {
  it("bands to a quarter point", () => {
    expect(cgpaBand(8.6)).toBe("8.50–8.75");
    expect(cgpaBand(9.0)).toBe("9.00–9.25");
    expect(cgpaBand(7.25)).toBe("7.25–7.50");
  });

  it("clamps at ten", () => {
    expect(cgpaBand(10)).toBe("10.00–10.00");
  });

  it("returns null for a missing CGPA", () => {
    expect(cgpaBand(null)).toBeNull();
    expect(cgpaBand(undefined)).toBeNull();
  });
});

describe("canShowName", () => {
  const base = { nameVisibility: "NAMED", verification: "ADMIN_VERIFIED", deletedAt: null };

  it("shows a name only on an explicit opt-in", () => {
    expect(canShowName(base)).toBe(true);
    expect(canShowName({ ...base, nameVisibility: "ANONYMOUS" })).toBe(false);
  });

  it("hides the name while a record is disputed or removed", () => {
    expect(canShowName({ ...base, verification: "DISPUTED" })).toBe(false);
    expect(canShowName({ ...base, verification: "REMOVED" })).toBe(false);
  });

  it("hides the name on a soft-deleted record", () => {
    expect(canShowName({ ...base, deletedAt: new Date() })).toBe(false);
  });
});

describe("compensation model", () => {
  // The FY2025-26 Indian new regime, as seeded.
  const regime: TaxRegime = {
    financialYear: "2025-26",
    slabs: [
      { upToLpa: 4, ratePercent: 0 },
      { upToLpa: 8, ratePercent: 5 },
      { upToLpa: 12, ratePercent: 10 },
      { upToLpa: 16, ratePercent: 15 },
      { upToLpa: 20, ratePercent: 20 },
      { upToLpa: 24, ratePercent: 25 },
      { upToLpa: null, ratePercent: 30 },
    ],
    standardDeductionInr: 75_000,
    cessPercent: 4,
    employeePfPercent: 12,
    professionalTaxInr: 2_400,
    rebateThresholdInr: 1_200_000,
  };

  it("applies the rebate so a modest package pays no income tax", () => {
    expect(incomeTaxInr(1_200_000, regime)).toBe(0);
    expect(incomeTaxInr(800_000, regime)).toBe(0);
  });

  it("taxes slab by slab above the rebate", () => {
    // 20 LPA gross - 75,000 standard deduction = 19.25L taxable.
    //   0-4L    @0%  = 0
    //   4-8L    @5%  = 20,000
    //   8-12L   @10% = 40,000
    //   12-16L  @15% = 60,000
    //   16-19.25 @20% = 65,000
    //   subtotal 185,000, +4% cess = 192,400
    expect(incomeTaxInr(2_000_000, regime)).toBeCloseTo(192_400, 0);
  });

  it("separates Meesho's retention-heavy headline from its real cash", () => {
    // 60 LPA headline, 24 base, with the sheet's note that "All the extra money
    // in CTC is majorly retention bonus over a period of 4-5 years".
    const derived = deriveCompensation(
      {
        baseLpa: 24,
        ctcLpa: 60,
        components: [
          {
            kind: "RETENTION_BONUS",
            amount: 30,
            currency: "INR",
            isLpa: true,
            isOneTime: true,
            isCash: true,
            vestingYears: null,
          },
        ],
      },
      regime,
    );

    expect(derived.steadyStateCashLpa).toBe(24);
    expect(derived.firstYearCashLpa).toBe(54);
    expect(derived.oneTimeCashLpa).toBe(30);
    // The headline is 1.1x the first-year cash and 2.5x the recurring cash.
    expect(derived.ctcInflationRatio).toBeCloseTo(60 / 54, 6);
  });

  it("excludes SAP's free lunch from cash", () => {
    const derived = deriveCompensation(
      {
        baseLpa: 10.5,
        ctcLpa: 26,
        components: [
          { kind: "JOINING_BONUS", amount: 3.5, currency: "INR", isLpa: true, isOneTime: true, isCash: true, vestingYears: null },
          { kind: "RSU", amount: 4, currency: "INR", isLpa: true, isOneTime: false, isCash: false, vestingYears: 3 },
          { kind: "PERKS", amount: 8, currency: "INR", isLpa: true, isOneTime: false, isCash: false, vestingYears: null },
        ],
      },
      regime,
    );

    expect(derived.nonCashLpa).toBe(12);
    expect(derived.steadyStateCashLpa).toBe(10.5);
    expect(derived.firstYearCashLpa).toBe(14);
    // A 26 LPA headline delivering 14 lakhs of cash in year one.
    expect(derived.ctcInflationRatio).toBeCloseTo(26 / 14, 6);
  });

  it("spreads dollar-denominated equity over its vesting period", () => {
    const derived = deriveCompensation(
      {
        baseLpa: 20,
        ctcLpa: 40,
        components: [
          { kind: "RSU", amount: 40_000, currency: "USD", isLpa: false, isOneTime: false, isCash: false, vestingYears: 2 },
        ],
        usdToInr: 88,
      },
      regime,
    );
    // $40,000 at 88 = 35.2 lakhs over two years = 17.6 LPA of non-cash.
    expect(derived.nonCashLpa).toBeCloseTo(17.6, 6);
    expect(derived.assumptions.join(" ")).toMatch(/US dollars/);
  });

  it("says so when it is guessing from the headline alone", () => {
    const derived = deriveCompensation(
      { baseLpa: null, ctcLpa: 12, components: [] },
      regime,
    );
    expect(derived.steadyStateCashLpa).toBe(12);
    expect(derived.assumptions.join(" ")).toMatch(/upper bound/i);
  });

  it("returns no take-home figure without a tax regime", () => {
    const derived = deriveCompensation({ baseLpa: 20, ctcLpa: 20, components: [] }, null);
    expect(derived.estimatedInHandMonthlyInr).toBeNull();
  });

  it("produces a plausible take-home for a 20 LPA package", () => {
    const derived = deriveCompensation({ baseLpa: 20, ctcLpa: 20, components: [] }, regime);
    // 20L gross, minus 96k employee PF, minus ~192k tax, minus 2.4k prof tax.
    expect(derived.estimatedInHandMonthlyInr).toBeGreaterThan(120_000);
    expect(derived.estimatedInHandMonthlyInr).toBeLessThan(150_000);
  });
});
