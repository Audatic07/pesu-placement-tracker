import type { CompensationComponentKind } from "@/generated/prisma/enums";

/** Pure compensation and tax calculations. Rates and tax configuration are supplied by the caller. */

export type ComponentInput = {
  kind: CompensationComponentKind;
  amount: number;
  currency: string;
  isLpa: boolean;
  isOneTime: boolean;
  isCash: boolean;
  vestingYears: number | null;
};

export type TaxSlab = {
  /** Upper bound of this slab in LPA; null means "and above". */
  upToLpa: number | null;
  ratePercent: number;
};

export type TaxRegime = {
  financialYear: string;
  slabs: TaxSlab[];
  standardDeductionInr: number;
  cessPercent: number;
  employeePfPercent: number;
  professionalTaxInr: number;
  /** Taxable income at or below this pays nothing (the s.87A-style rebate). */
  rebateThresholdInr: number | null;
};

export type PackageInput = {
  baseLpa: number | null;
  ctcLpa: number | null;
  components: ComponentInput[];
  /** Rupees per USD, for equity quoted in dollars. */
  usdToInr?: number;
};

export type DerivedCompensation = {
  /** Cash reaching the student in year one, in LPA. */
  firstYearCashLpa: number | null;
  /** Recurring annual cash once one-time components fall away, in LPA. */
  steadyStateCashLpa: number | null;
  /** Post-tax monthly take-home, in rupees. */
  estimatedInHandMonthlyInr: number | null;
  /**
   * ctc / firstYearCash. 1.0 means the headline is honest. 2.5 means most of
   * the number is equity, retention money and free lunch.
   */
  ctcInflationRatio: number | null;
  /** Total non-cash value (equity, insurance, perks) in LPA. */
  nonCashLpa: number;
  /** One-time cash (joining bonus, relocation) in LPA. */
  oneTimeCashLpa: number;
  /** Assumptions used, shown alongside the figure so it is never mistaken for a promise. */
  assumptions: string[];
};

/** Default only for display when a package quotes equity in dollars. */
export const DEFAULT_USD_TO_INR = 88;

function toLpa(component: ComponentInput, usdToInr: number): number {
  if (component.currency === "INR" && component.isLpa) return component.amount;
  if (!component.isCash && (component.vestingYears === null || component.vestingYears <= 0)) return 0;
  const inr = component.amount * (component.currency === "USD" ? usdToInr : 1);
  const years = component.vestingYears && component.vestingYears > 0 ? component.vestingYears : 1;
  return inr / 100_000 / years;
}

/**
 * Annual income tax under a slab regime, in rupees.
 * Exported because the estimate must be reproducible by anyone checking it.
 */
export function incomeTaxInr(taxableInr: number, regime: TaxRegime): number {
  const afterStandardDeduction = Math.max(0, taxableInr - regime.standardDeductionInr);

  if (
    regime.rebateThresholdInr !== null &&
    afterStandardDeduction <= regime.rebateThresholdInr
  ) {
    return 0;
  }

  let tax = 0;
  let lowerBoundInr = 0;

  for (const slab of regime.slabs) {
    const upperBoundInr = slab.upToLpa === null ? Infinity : slab.upToLpa * 100_000;
    if (afterStandardDeduction <= lowerBoundInr) break;

    const taxableInThisSlab = Math.min(afterStandardDeduction, upperBoundInr) - lowerBoundInr;
    if (taxableInThisSlab > 0) tax += (taxableInThisSlab * slab.ratePercent) / 100;

    lowerBoundInr = upperBoundInr;
  }

  return tax * (1 + regime.cessPercent / 100);
}

export function deriveCompensation(
  input: PackageInput,
  regime: TaxRegime | null,
): DerivedCompensation {
  const usdToInr = input.usdToInr ?? DEFAULT_USD_TO_INR;
  const assumptions: string[] = [];

  let recurringCash = 0;
  let oneTimeCash = 0;
  let nonCash = 0;
  let sawUsd = false;
  let uncertainCashTiming = false;

  for (const component of input.components) {
    const lpa = toLpa(component, usdToInr);
    if (component.currency === "USD") sawUsd = true;

    if (!component.isCash) {
      nonCash += lpa;
    } else if (component.isOneTime) {
      oneTimeCash += lpa;
      if (component.kind === "RETENTION_BONUS" || (component.vestingYears !== null && component.vestingYears > 1)) {
        uncertainCashTiming = true;
      }
    } else {
      recurringCash += lpa;
    }
  }

  if (input.components.some((component) => !component.isCash && !component.isLpa && component.vestingYears === null)) {
    assumptions.push("Non-cash grants without a vesting term are preserved but excluded from annual valuations.");
  }

  // Cash requires a stated base; a headline CTC can include undisclosed benefits.
  const itemisedBase = input.components
    .filter((component) => component.kind === "FIXED_BASE")
    .reduce((sum, component) => sum + toLpa(component, usdToInr), 0);

  let recurringBase: number | null = null;
  if (itemisedBase > 0) {
    recurringBase = recurringCash;
  } else if (input.baseLpa !== null) {
    recurringBase = input.baseLpa + recurringCash;
    assumptions.push("Recurring pay taken from the stated base plus itemised recurring components.");
  } else if (input.ctcLpa !== null) {
    assumptions.push(
      "Base pay is unknown. Headline CTC alone cannot establish cash pay or monthly take-home.",
    );
  }

  if (recurringBase !== null && recurringBase < 0) recurringBase = 0;

  const firstYearCash = recurringBase === null || uncertainCashTiming ? null : recurringBase + oneTimeCash;
  const steadyStateCash = recurringBase;

  if (uncertainCashTiming) assumptions.push("A staged or retention bonus has no confirmed year-one payout schedule; first-year cash is unknown.");
  if (input.components.some((component) => component.kind === "VARIABLE_PAY" && component.amount > 0)) {
    assumptions.push("Variable pay is a target; actual payout may differ.");
  }

  if (sawUsd) {
    assumptions.push(
      `Equity quoted in US dollars converted at ₹${usdToInr}/USD and spread across its vesting period.`,
    );
  }
  if (nonCash > 0) {
    assumptions.push(
      `₹${(nonCash * 100_000).toLocaleString("en-IN", { maximumFractionDigits: 0 })} of the package is equity, insurance or perks rather than cash.`,
    );
  }

  let inHandMonthly: number | null = null;
  if (regime && steadyStateCash !== null && steadyStateCash > 0) {
    const grossInr = steadyStateCash * 100_000;
    // Employee PF is levied on basic pay, conventionally around 40% of gross
    // for entry-level Indian offers. Stated rather than hidden.
    const basicInr = grossInr * 0.4;
    const pfInr = (basicInr * regime.employeePfPercent) / 100;
    const taxInr = incomeTaxInr(grossInr, regime);

    inHandMonthly = (grossInr - pfInr - taxInr - regime.professionalTaxInr) / 12;
    if (inHandMonthly < 0) inHandMonthly = 0;

    assumptions.push(
      `Income tax under the ${regime.financialYear} slabs; employee PF at ${regime.employeePfPercent}% of basic, with basic assumed to be 40% of gross.`,
      "One-time joining money is excluded from the monthly figure — it arrives once, not every month.",
    );
  }

  const ctcInflationRatio =
    input.ctcLpa !== null && firstYearCash !== null && firstYearCash > 0
      ? input.ctcLpa / firstYearCash
      : null;

  return {
    firstYearCashLpa: firstYearCash,
    steadyStateCashLpa: steadyStateCash,
    estimatedInHandMonthlyInr: inHandMonthly,
    ctcInflationRatio,
    nonCashLpa: nonCash,
    oneTimeCashLpa: oneTimeCash,
    assumptions,
  };
}
