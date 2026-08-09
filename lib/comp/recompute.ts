import type { PrismaClient } from "@/generated/prisma/client";
import { deriveCompensation, type TaxRegime } from "./model";

/**
 * Recomputes the cached derived figures on compensation packages.
 *
 * These are cached rather than computed per request because the dashboard sorts
 * and filters on them, and because they depend on a tax table that changes once
 * a year — not on anything that changes per request.
 *
 * Run after an import, and again whenever the tax configuration changes. It is
 * idempotent, so running it more often than necessary costs only time.
 */

export type RecomputeResult = {
  packagesConsidered: number;
  packagesUpdated: number;
  financialYear: string | null;
};

async function loadRegime(
  prisma: PrismaClient,
  financialYear?: string,
): Promise<TaxRegime | null> {
  const row = financialYear
    ? await prisma.taxRegimeConfig.findUnique({ where: { financialYear } })
    : await prisma.taxRegimeConfig.findFirst({ orderBy: { financialYear: "desc" } });

  if (!row) return null;

  // The slab table is JSON because the NUMBER of slabs changes between budgets,
  // not just the rates. Validate its shape rather than trusting the column.
  const slabs = Array.isArray(row.slabs) ? row.slabs : [];
  const parsed = slabs
    .map((slab) => {
      if (typeof slab !== "object" || slab === null) return null;
      const record = slab as Record<string, unknown>;
      const upTo = record["upToLpa"];
      const rate = record["ratePercent"];
      if (typeof rate !== "number") return null;
      return {
        upToLpa: typeof upTo === "number" ? upTo : null,
        ratePercent: rate,
      };
    })
    .filter((slab): slab is { upToLpa: number | null; ratePercent: number } => slab !== null);

  if (parsed.length === 0) return null;

  return {
    financialYear: row.financialYear,
    slabs: parsed,
    standardDeductionInr: Number(row.standardDeductionInr),
    cessPercent: Number(row.cessPercent),
    employeePfPercent: Number(row.employeePfPercent),
    professionalTaxInr: Number(row.professionalTaxInr),
    rebateThresholdInr:
      row.rebateThresholdInr === null ? null : Number(row.rebateThresholdInr),
  };
}

export async function recomputeDerivedCompensation(
  prisma: PrismaClient,
  options: { financialYear?: string; usdToInr?: number } = {},
): Promise<RecomputeResult> {
  const regime = await loadRegime(prisma, options.financialYear);

  const packages = await prisma.compensationPackage.findMany({
    include: { components: true },
  });

  let updated = 0;

  for (const pkg of packages) {
    const derived = deriveCompensation(
      {
        baseLpa: pkg.baseLpa === null ? null : Number(pkg.baseLpa),
        ctcLpa: pkg.ctcLpa === null ? null : Number(pkg.ctcLpa),
        components: pkg.components.map((component) => ({
          kind: component.kind,
          amount: Number(component.amount),
          currency: component.currency,
          isLpa: component.isLpa,
          isOneTime: component.isOneTime,
          isCash: component.isCash,
          vestingYears:
            component.vestingYears === null ? null : Number(component.vestingYears),
        })),
        usdToInr: options.usdToInr,
      },
      regime,
    );

    await prisma.compensationPackage.update({
      where: { id: pkg.id },
      data: {
        firstYearCashLpa: derived.firstYearCashLpa,
        steadyStateCashLpa: derived.steadyStateCashLpa,
        estimatedInHandMonthlyInr: derived.estimatedInHandMonthlyInr,
        ctcInflationRatio: derived.ctcInflationRatio,
        computedForFinancialYear: regime?.financialYear ?? null,
        computedAt: new Date(),
      },
    });
    updated += 1;
  }

  return {
    packagesConsidered: packages.length,
    packagesUpdated: updated,
    financialYear: regime?.financialYear ?? null,
  };
}
