import { loadTaxRegime } from "./regime";
import type { PrismaClient } from "@/generated/prisma/client";
import { deriveCompensation } from "./model";

/** Refresh cached compensation after imports or tax configuration changes. */

export type RecomputeResult = {
  packagesConsidered: number;
  packagesUpdated: number;
  financialYear: string | null;
};

export async function recomputeDerivedCompensation(
  prisma: PrismaClient,
  options: { financialYear?: string; usdToInr?: number } = {},
): Promise<RecomputeResult> {
  const regime = await loadTaxRegime(prisma, options.financialYear);

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
