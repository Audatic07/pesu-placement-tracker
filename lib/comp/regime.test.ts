import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import type { TaxRegimeConfigModel } from "@/generated/prisma/models";
import { decodeTaxRegime } from "./regime";

const row: TaxRegimeConfigModel = {
  id: "test-regime",
  financialYear: "2025-26",
  regimeName: "new",
  slabs: [{ upToLpa: 4, ratePercent: 0 }, { upToLpa: null, ratePercent: 30 }],
  standardDeductionInr: new Prisma.Decimal(75_000),
  cessPercent: new Prisma.Decimal(4),
  employeePfPercent: new Prisma.Decimal(12),
  professionalTaxInr: new Prisma.Decimal(2_400),
  rebateThresholdInr: null,
  notes: null,
};

describe("tax configuration", () => {
  it("decodes decimal columns and the unbounded final slab", () => {
    expect(decodeTaxRegime(row)).toMatchObject({
      slabs: row.slabs,
      standardDeductionInr: 75_000,
      cessPercent: 4,
      rebateThresholdInr: null,
    });
  });

  it.each([null, [], [null], [{ ratePercent: 5 }], [{ upToLpa: null, ratePercent: "30" }]])(
    "refuses malformed slab tables instead of producing a partial estimate: %j", (slabs) => {
      expect(decodeTaxRegime({ ...row, slabs })).toBeNull();
    },
  );
});
