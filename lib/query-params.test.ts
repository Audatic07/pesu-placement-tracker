import { describe, expect, it } from "vitest";
import { choiceList, positiveInteger, resolveBatchYear, singleParams } from "./query-params";

describe("query parameters", () => {
  it("normalizes repeated parameters to the first value", () => {
    expect(singleParams({ batch: ["2027", "9998"], page: [], q: "labs" })).toEqual({
      batch: "2027", page: undefined, q: "labs",
    });
  });

  it.each([undefined, "", "0", "-1", "1.5", "2junk", "Infinity", "9007199254740992"])(
    "uses the page fallback for %s", (value) => {
      expect(positiveInteger(value)).toBe(1);
    },
  );

  it("removes duplicate and invalid enum filters", () => {
    expect(choiceList(" students,invalid,students,imported ", ["students", "imported"])).toEqual([
      "students", "imported",
    ]);
    expect(choiceList("invalid", ["students", "imported"])).toBeUndefined();
  });

  it("resolves the batch from a valid URL, student year, available years, then the clock", () => {
    expect(resolveBatchYear("2026", [2027, 2026], 2027)).toBe(2026);
    expect(resolveBatchYear("2026junk", [2027, 2026], 2027)).toBe(2027);
    expect(resolveBatchYear(undefined, [2027, 2026], null)).toBe(2027);
    expect(resolveBatchYear(undefined, [], null, 2030)).toBe(2030);
  });
});
