import { describe, expect, it } from "vitest";
import {
  csvCell,
  decodeImport,
  importTemplate,
  parseCsv,
  MAX_IMPORT_BYTES,
} from "./csv";
import { AdminOfferInput, parseAdminOfferForm } from "./input";

const header =
  "batch_year,company_name,role_title,cycle,source_note,headcount,ctc_lpa,base_lpa,stipend_inr";

describe("administrative imports", () => {
  it("reads quoted commas, double quotes, newlines, BOM and CRLF", () => {
    expect(
      parseCsv(
        '\uFEFFcompany,notes\r\n"Example, Inc.","A ""quote""\nthen text"\r\n',
      ),
    ).toEqual([
      ["company", "notes"],
      ["Example, Inc.", 'A "quote"\nthen text'],
    ]);
  });
  it("preserves unknown compensation and acceptance instead of inventing zero or acceptance", () => {
    const result = decodeImport(
      `${header}\n2026,Example,Engineer,FULL_TIME,Sheet 2026,3,,,`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      headcount: 3,
      acceptanceStatus: "UNKNOWN",
      ctcLpa: undefined,
      baseLpa: undefined,
      stipendPerMonthInr: undefined,
    });
    expect(result.outcomes).toBe(3);
  });
  it("preserves stated zero", () => {
    expect(
      decodeImport(
        `${header}\n2026,Example,Engineer,FULL_TIME,Sheet 2026,1,0,0,0`,
      ).rows[0]?.ctcLpa,
    ).toBe(0);
  });
  it("rejects ambiguous duplicate and unknown headings", () => {
    expect(() => decodeImport("company_name,company_name\nA,B")).toThrow(
      /duplicate/,
    );
    expect(() => decodeImport("password\nsecret")).toThrow(/Unknown/);
  });
  it("rejects malformed quoting, oversized files and excess outcomes", () => {
    expect(() => parseCsv('a\n"unterminated')).toThrow(/not closed/);
    expect(() => parseCsv('a\n"closed"suffix')).toThrow(/quoting/);
    expect(() => parseCsv("x".repeat(MAX_IMPORT_BYTES + 1))).toThrow(/smaller/);
    const result = decodeImport(
      `${header}\n${Array.from({ length: 6 }, () => "2026,Example,Engineer,FULL_TIME,Sheet 2026,100,10,8,").join("\n")}`,
    );
    expect(result.errors[0]).toMatch(/500 outcomes/);
  });
  it("reports the row with invalid fields and does not silently skip it", () => {
    const result = decodeImport(
      `${header}\n2026,Example,Engineer,FULL_TIME,Sheet 2026,1,8,12,`,
    );
    expect(result.errors[0]).toMatch(/Row 2.*Fixed base cannot exceed CTC/);
  });
  it("refuses awarded FTE compensation for internship-only outcomes", () => {
    expect(
      decodeImport(
        `${header}\n2026,Example,Intern,SIX_MONTH_INTERNSHIP,Sheet 2026,1,12,8,30000`,
      ).errors[0],
    ).toMatch(/conditional FTE package/);
  });
  it("does not let a CSV carry student identity or elevate the author", () => {
    expect(() =>
      decodeImport(
        `${header},student_id\n2026,Example,Engineer,FULL_TIME,Sheet 2026,1,12,8,,victim`,
      ),
    ).toThrow(/Unknown/);
    expect(Object.keys(AdminOfferInput.shape)).not.toContain("studentId");
    expect(Object.keys(AdminOfferInput.shape)).not.toContain("role");
  });
  it("makes formula exports inert, including whitespace-prefixed formulas", () => {
    for (const value of [
      "=WEBSERVICE(1)",
      "+SUM(1,2)",
      "-1+1",
      "@SUM(1)",
      "  =1",
      "\t=1",
    ])
      expect(csvCell(value)).toContain("'");
    expect(csvCell('Example "Company", Ltd')).toBe(
      '"Example ""Company"", Ltd"',
    );
  });
  it("emits a header-only template and rejects empty data", () => {
    expect(decodeImport(importTemplate()).errors).toEqual([
      "Add at least one data row below the headings.",
    ]);
  });
  it("decodes blank form values without inventing amounts", () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      batchYear: "2026",
      companyName: "Example",
      roleTitle: "Engineer",
      cycle: "FULL_TIME",
      reason: "Sheet 2026",
      ctcLpa: "",
      baseLpa: "",
      stipendPerMonthInr: "",
    }))
      form.set(key, value);
    const parsed = parseAdminOfferForm(form);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Expected valid administrative form");
    expect(parsed.data.ctcLpa).toBeUndefined();
  });
});
