import { describe, expect, it } from "vitest";
import { parseSheetDate, seasonWindowForBatch } from "./dates";

const window2026 = seasonWindowForBatch(2026);
const iso = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

describe("parseSheetDate — plain strings", () => {
  it("reads DD/MM/YY", () => {
    const result = parseSheetDate("04/08/25", window2026);
    expect(iso(result.start)).toBe("2025-08-04");
    expect(result.end).toBeNull();
    expect(result.isAmbiguous).toBe(false);
  });

  it("reads DD/MM/YYYY", () => {
    expect(iso(parseSheetDate("20/09/2025", window2026).start)).toBe("2025-09-20");
  });

  it("keeps day-first even when the day could be a month", () => {
    // 03/08/25 must be 3 August, not 8 March — these sheets are day-first.
    expect(iso(parseSheetDate("03/08/25", window2026).start)).toBe("2025-08-03");
  });
});

describe("parseSheetDate — ranges", () => {
  it("reads a two-date range", () => {
    const result = parseSheetDate("29/10/25 - 30/10/25", window2026);
    expect(iso(result.start)).toBe("2025-10-29");
    expect(iso(result.end)).toBe("2025-10-30");
  });

  it("reads a same-month day range", () => {
    const result = parseSheetDate("13-14/11/25", window2026);
    expect(iso(result.start)).toBe("2025-11-13");
    expect(iso(result.end)).toBe("2025-11-14");
  });

  it("reads a wider same-month range", () => {
    const result = parseSheetDate("26-28/11/25", window2026);
    expect(iso(result.start)).toBe("2025-11-26");
    expect(iso(result.end)).toBe("2025-11-28");
  });

  it("reads a range spanning months", () => {
    const result = parseSheetDate("20/11/25 - 25/11/25", window2026);
    expect(iso(result.start)).toBe("2025-11-20");
    expect(iso(result.end)).toBe("2025-11-25");
  });
});

describe("parseSheetDate — non-dates", () => {
  it.each(["No OA", "TBD", "N/A", "-", "Yet to even come to campus"])(
    "flags %s as not a date",
    (input) => {
      const result = parseSheetDate(input, window2026);
      expect(result.start).toBeNull();
      expect(result.isNonDate).toBe(true);
      expect(result.raw).toBe(input);
    },
  );

  it("returns empty for blank cells without flagging anything", () => {
    const result = parseSheetDate(null, window2026);
    expect(result.start).toBeNull();
    expect(result.isNonDate).toBe(false);
    expect(result.isAmbiguous).toBe(false);
  });
});

describe("parseSheetDate — prose with several dates", () => {
  it("takes the first date and says so", () => {
    const result = parseSheetDate(
      "1st round - 07/10/2025 2nd rund - 11/10/2025",
      window2026,
    );
    expect(iso(result.start)).toBe("2025-10-07");
    expect(result.note).toMatch(/contains 2 dates/);
    expect(result.raw).toContain("2nd rund");
  });
});

describe("parseSheetDate — spreadsheet-mangled Date objects", () => {
  it("un-swaps a date that only makes sense swapped", () => {
    // Stored 11 March 2025. The season starts in August 2025, so March is
    // impossible; the intended value was 3 November.
    const result = parseSheetDate(new Date("2025-03-11T00:00:00Z"), window2026);
    expect(iso(result.start)).toBe("2025-11-03");
    expect(result.isAmbiguous).toBe(false);
    expect(result.note).toMatch(/day\/month swapped/);
  });

  it("un-swaps 2025-04-11 to 4 November", () => {
    expect(iso(parseSheetDate(new Date("2025-04-11T00:00:00Z"), window2026).start)).toBe(
      "2025-11-04",
    );
  });

  it("un-swaps a date in the graduating year", () => {
    // Stored 1 December 2026 — beyond the season. Intended: 12 January 2026.
    expect(iso(parseSheetDate(new Date("2026-12-01T00:00:00Z"), window2026).start)).toBe(
      "2026-01-12",
    );
  });

  it("leaves a date alone when the day could not have been a month", () => {
    // Day 19 cannot be a month, so no swap ever happened.
    const result = parseSheetDate(new Date("2025-11-19T00:00:00Z"), window2026);
    expect(iso(result.start)).toBe("2025-11-19");
    expect(result.isAmbiguous).toBe(false);
  });

  it("leaves a symmetric date alone", () => {
    // 12/12 reads the same either way.
    const result = parseSheetDate(new Date("2025-12-12T00:00:00Z"), window2026);
    expect(iso(result.start)).toBe("2025-12-12");
    expect(result.isAmbiguous).toBe(false);
  });

  it("flags genuinely ambiguous dates instead of guessing", () => {
    // Stored 6 December 2025; swapped is 12 June 2025... which is outside the
    // window, so this one resolves. Use a case where both are inside instead:
    // stored 9 December 2025, swapped 12 September 2025 — both in season.
    const result = parseSheetDate(new Date("2025-12-09T00:00:00Z"), window2026);
    expect(result.isAmbiguous).toBe(true);
    expect(result.note).toMatch(/Ambiguous/);
  });

  it("resolves when only one reading is inside the season", () => {
    // Stored 6 December 2025; swapped would be 12 June 2025, before the
    // 1 August 2025 season start, so the stored reading stands.
    const result = parseSheetDate(new Date("2025-12-06T00:00:00Z"), window2026);
    expect(iso(result.start)).toBe("2025-12-06");
    expect(result.isAmbiguous).toBe(false);
  });
});

describe("seasonWindowForBatch", () => {
  it("opens on 1 August of the preceding year", () => {
    expect(iso(seasonWindowForBatch(2026).start)).toBe("2025-08-01");
  });
});
