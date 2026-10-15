import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { archiveFixture } from "../../scripts/admin/archive-fixture";
import {
  archiveSummary,
  decodePlacementArchive,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_EXPANDED_BYTES,
  PlacementArchive,
} from "./archive-schema";

const compress = (value: unknown) => gzipSync(JSON.stringify(value));

describe("historical placement archives", () => {
  it("round-trips compensation, currencies, vesting, raw dates and unknown recipients", () => {
    const fixture = archiveFixture();
    expect(decodePlacementArchive(compress(fixture))).toEqual(fixture);
    expect(archiveSummary(fixture)).toMatchObject({
      outcomes: 1,
      companies: 1,
      components: 1,
      rounds: 1,
      batches: { "2001": 1 },
    });
  });
  it("preserves stated zero separately from undisclosed amounts", () => {
    const fixture = archiveFixture();
    fixture.entries[0]!.compensation.ctcLpa = 0;
    fixture.entries[0]!.compensation.baseLpa = null;
    expect(
      decodePlacementArchive(compress(fixture)).entries[0]!.compensation,
    ).toMatchObject({ ctcLpa: 0, baseLpa: null });
  });
  it("binds review to the entire archive, including notes and rounds", () => {
    const fixture = archiveFixture();
    const original = archiveSummary(fixture).digest;
    fixture.entries[0]!.rounds[0]!.rawSchedule = "TBD";
    expect(archiveSummary(fixture).digest).not.toBe(original);
  });
  it("refuses inconsistent manifests, duplicate outcomes and cross-linked records", () => {
    const fixture = archiveFixture();
    expect(
      PlacementArchive.safeParse({ ...fixture, expected: { "2001": 2 } })
        .success,
    ).toBe(false);
    expect(
      PlacementArchive.safeParse({
        ...fixture,
        expected: { "2001": 2 },
        entries: [...fixture.entries, ...fixture.entries],
      }).success,
    ).toBe(false);
    fixture.entries[0]!.compensation.id = "another-package";
    expect(PlacementArchive.safeParse(fixture).success).toBe(false);
    fixture.entries[0]!.compensation.id = `${fixture.entries[0]!.id}-package`;
    fixture.entries[0]!.rounds[0]!.id = "another-round";
    expect(PlacementArchive.safeParse(fixture).success).toBe(false);
  });
  it("refuses identities, inferred CGPAs and authority supplied by the upload", () => {
    for (const patch of [
      { studentId: "private-student" },
      { cgpa: 8 },
      { source: "SELF_REPORTED" },
      { nameVisibility: "NAMED" },
      { verification: "VERIFIED" },
      { role: "SUPER_ADMIN" },
    ]) {
      const fixture = archiveFixture();
      expect(
        PlacementArchive.safeParse({
          ...fixture,
          entries: [{ ...fixture.entries[0], ...patch }],
        }).success,
      ).toBe(false);
    }
  });
  it("refuses conditional FTE packages for internship-only outcomes", () => {
    const fixture = archiveFixture();
    fixture.entries[0]!.nature = "INTERNSHIP_ONLY";
    expect(PlacementArchive.safeParse(fixture).success).toBe(false);
    fixture.entries[0]!.compensation.ctcLpa = null;
    fixture.entries[0]!.compensation.baseLpa = null;
    expect(PlacementArchive.safeParse(fixture).success).toBe(true);
  });
  it("bounds compressed and expanded data before accepting it", () => {
    expect(() =>
      decodePlacementArchive(new Uint8Array(MAX_ARCHIVE_BYTES + 1)),
    ).toThrow(/smaller/);
    expect(() =>
      decodePlacementArchive(
        gzipSync(Buffer.alloc(MAX_ARCHIVE_EXPANDED_BYTES + 1)),
      ),
    ).toThrow(/larger than/);
    expect(() => decodePlacementArchive(Buffer.from("not gzip"))).toThrow(
      /header/,
    );
    expect(() => decodePlacementArchive(compress({ entries: [] }))).toThrow(
      /pesu-placement-archive/,
    );
  });
});
