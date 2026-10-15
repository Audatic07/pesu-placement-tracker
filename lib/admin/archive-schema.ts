import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  AcceptanceStatus,
  CompensationComponentKind,
  DisclosureStatus,
  OfferCycle,
  OfferNature,
  RoleFamily,
  RoundKind,
  RoundMode,
  WorkMode,
} from "@/generated/prisma/enums";

export const MAX_ARCHIVE_BYTES = 512_000;
export const MAX_ARCHIVE_EXPANDED_BYTES = 24_000_000;
const amount = z.number().finite().nonnegative().max(1_000_000_000);
const nullableAmount = amount.nullable();
const note = z.string().max(8000).nullable();
const date = z.iso.datetime().nullable().optional();
const id = z.string().regex(/^handmade-[a-f0-9]{32}$/);

const component = z.strictObject({
  kind: z.enum(CompensationComponentKind),
  label: z.string().max(200).nullable().optional(),
  amount,
  currency: z.string().regex(/^[A-Z]{3}$/),
  isLpa: z.boolean(),
  isOneTime: z.boolean(),
  vestingYears: z.number().finite().min(0).max(100).nullable(),
  isCash: z.boolean(),
  note: note.optional(),
});

const round = z.strictObject({
  id: z.string().max(100),
  sequence: z.number().int().min(1).max(20),
  kind: z.enum(RoundKind),
  mode: z.enum(RoundMode),
  heldOn: date,
  heldUntil: date,
  rawSchedule: note.optional(),
  topics: z.array(z.string().max(200)).max(30),
  notes: note.optional(),
});

const entry = z.strictObject({
  id,
  batchYear: z.number().int().min(2000).max(2099),
  companyName: z.string().trim().min(1).max(160),
  roleTitle: z.string().min(1).max(160),
  roleFamily: z.enum(RoleFamily),
  cycle: z.enum(OfferCycle),
  nature: z.enum(OfferNature),
  tierKey: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,29}$/)
    .nullable(),
  // A published headcount never establishes a recipient's identity or CGPA.
  studentId: z.null(),
  branchId: z.null(),
  cgpa: z.null(),
  cgpaBand: z.null(),
  offerDate: z.null(),
  announcedCgpaCutoff: z.number().finite().min(0).max(10).nullable(),
  eligibleBranches: z.array(z.string().max(30)).max(30),
  locations: z.array(z.string().max(100)).max(20),
  workMode: z.enum(WorkMode),
  bondMonths: z.number().int().min(0).max(120).nullable(),
  internshipDurationMonths: z.number().int().min(0).max(36).nullable(),
  acceptanceStatus: z.enum(AcceptanceStatus),
  nameVisibility: z.literal("ANONYMOUS"),
  source: z.literal("OFFICIAL_IMPORT"),
  verification: z.literal("UNVERIFIED"),
  confidenceScore: z.literal(0),
  processNotes: z.string().min(1).max(8000),
  compensation: z.strictObject({
    id: z.string().max(100),
    stipendPerMonthInr: nullableAmount,
    baseLpa: nullableAmount,
    ctcLpa: nullableAmount,
    disclosure: z.enum(DisclosureStatus),
    rawNote: note,
    firstYearCashLpa: nullableAmount,
    steadyStateCashLpa: nullableAmount,
    estimatedInHandMonthlyInr: nullableAmount,
    ctcInflationRatio: z.number().finite().min(0).max(999).nullable(),
    computedForFinancialYear: z.string().max(20).nullable(),
    components: z.array(component).max(12),
  }),
  rounds: z.array(round).max(12),
});

export const PlacementArchive = z
  .strictObject({
    format: z.literal("pesu-placement-archive"),
    version: z.literal(1),
    expected: z.record(
      z.string().regex(/^20\d{2}$/),
      z.number().int().min(1).max(10_000),
    ),
    entries: z.array(entry).min(1).max(10_000),
  })
  .superRefine((archive, context) => {
    const counts: Record<string, number> = {};
    const ids = new Set<string>();
    for (const value of archive.entries) {
      counts[value.batchYear] = (counts[value.batchYear] ?? 0) + 1;
      if (ids.has(value.id))
        context.addIssue({
          code: "custom",
          message: "An archive outcome ID is duplicated.",
        });
      ids.add(value.id);
      if (
        value.compensation.id !== `${value.id}-package` ||
        value.rounds.some(
          (item) => item.id !== `${value.id}-round-${item.sequence}`,
        ) ||
        new Set(value.rounds.map((item) => item.sequence)).size !==
          value.rounds.length
      )
        context.addIssue({
          code: "custom",
          message: "Package and round IDs must belong to their outcome.",
        });
      if (
        value.nature === "INTERNSHIP_ONLY" &&
        (value.compensation.ctcLpa !== null ||
          value.compensation.baseLpa !== null)
      )
        context.addIssue({
          code: "custom",
          message:
            "Internship-only outcomes cannot award conditional FTE compensation.",
        });
    }
    const years = Object.keys(counts).sort();
    if (
      years.length > 20 ||
      JSON.stringify(years) !==
        JSON.stringify(Object.keys(archive.expected).sort()) ||
      years.some((year) => counts[year] !== archive.expected[year])
    )
      context.addIssue({
        code: "custom",
        message: "Outcome counts do not match the archive manifest.",
      });
  });

export type PlacementArchiveData = z.infer<typeof PlacementArchive>;

export function decodePlacementArchive(
  bytes: Uint8Array,
): PlacementArchiveData {
  if (!bytes.length || bytes.length > MAX_ARCHIVE_BYTES)
    throw new Error("Upload a compressed archive smaller than 500 KB.");
  const expanded = gunzipSync(bytes, {
    maxOutputLength: MAX_ARCHIVE_EXPANDED_BYTES,
  });
  return PlacementArchive.parse(JSON.parse(expanded.toString("utf8")));
}

export function archiveSummary(archive: PlacementArchiveData) {
  return {
    digest: createHash("sha256").update(JSON.stringify(archive)).digest("hex"),
    batches: archive.expected,
    outcomes: archive.entries.length,
    companies: new Set(archive.entries.map((value) => value.companyName)).size,
    components: archive.entries.reduce(
      (sum, value) => sum + value.compensation.components.length,
      0,
    ),
    rounds: archive.entries.reduce(
      (sum, value) => sum + value.rounds.length,
      0,
    ),
  };
}
