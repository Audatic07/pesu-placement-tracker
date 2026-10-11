import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { TaxRegimeConfigModel } from "@/generated/prisma/models";
import type { TaxRegime } from "./model";

const Slabs = z.array(z.object({
  upToLpa: z.number().nonnegative().nullable(),
  ratePercent: z.number().min(0).max(100),
})).min(1);

export function decodeTaxRegime(row: TaxRegimeConfigModel): TaxRegime | null {
  const slabs = Slabs.safeParse(row.slabs);
  if (!slabs.success) return null;

  return {
    financialYear: row.financialYear,
    slabs: slabs.data,
    standardDeductionInr: Number(row.standardDeductionInr),
    cessPercent: Number(row.cessPercent),
    employeePfPercent: Number(row.employeePfPercent),
    professionalTaxInr: Number(row.professionalTaxInr),
    rebateThresholdInr: row.rebateThresholdInr === null ? null : Number(row.rebateThresholdInr),
  };
}

export async function loadTaxRegime(
  prisma: PrismaClient,
  financialYear?: string,
): Promise<TaxRegime | null> {
  const row = financialYear
    ? await prisma.taxRegimeConfig.findUnique({ where: { financialYear } })
    : await prisma.taxRegimeConfig.findFirst({ orderBy: { financialYear: "desc" } });
  return row ? decodeTaxRegime(row) : null;
}
