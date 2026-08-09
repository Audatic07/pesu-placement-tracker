import type {
  DisclosureStatus,
  OfferCycle,
  RoundKind,
  RoundMode,
} from "@/generated/prisma/enums";
import type { CompanyFlags } from "../lib/colors";
import type { ParsedComponent } from "../lib/compensation";
import type { ParsedGpaCutoff } from "../lib/gpa";

/**
 * The shape the sheet readers produce and the loader consumes.
 *
 * Deliberately not Prisma types: the readers should be testable without a
 * database, and the mapping from "what the spreadsheet said" to "what we store"
 * belongs in one place (the loader) rather than smeared across six tab parsers.
 */

export type ImportedRound = {
  kind: RoundKind;
  mode: RoundMode;
  sequence: number;
  heldOn: Date | null;
  heldUntil: Date | null;
  rawSchedule: string | null;
};

export type ImportedRole = {
  title: string | null;
  stipendPerMonthInr: number | null;
  baseLpa: number | null;
  ctcLpa: number | null;
  /**
   * True when this role's compensation cells were merge continuations — the
   * source is saying these roles share one advertised package, not that each
   * has its own identical one. The loader links them to the same package row so
   * statistics count it once.
   */
  sharesCompensationWithPrevious: boolean;
  disclosure: DisclosureStatus;
  compensationNote: string | null;
  components: ParsedComponent[];
  placedInternship: number | null;
  placedFte: number | null;
  placedBoth: number | null;
  locations: string[];
  bondMonths: number | null;
  internshipDurationMonths: number | null;
  note: string | null;
  rounds: ImportedRound[];
  sheetRow: number;
};

export type ImportedDrive = {
  companyName: string;
  /** A status the sheet appended to the name, e.g. "DID NOT PROCEED". */
  inlineNote: string | null;
  tierKey: string | null;
  cycle: OfferCycle;
  eligibleBranches: string[];
  gpaCutoff: ParsedGpaCutoff;
  flags: CompanyFlags;
  pptDate: Date | null;
  note: string | null;
  roles: ImportedRole[];
  sheet: string;
  sheetRow: number;
};

/**
 * The totals the sheet computed for itself. Re-deriving these from the imported
 * rows is how we prove the import is faithful — if our numbers disagree with
 * the source's own footer, the import is wrong.
 */
export type SheetFooterStats = {
  sheet: string;
  companiesVisited: number | null;
  placedInternship: number | null;
  placedFte: number | null;
  placedBoth: number | null;
  placedTotal: number | null;
  highestCtc: number | null;
  averageCtc: number | null;
  medianCtc: number | null;
  weightedAverageCtc: number | null;
  weightedMedianCtc: number | null;
  highestBase: number | null;
  averageBase: number | null;
  medianBase: number | null;
  highestStipend: number | null;
  averageStipend: number | null;
  medianStipend: number | null;
  companiesWithTenPlus: number | null;
  massRecruiters: number | null;
  ditchedCompanies: number | null;
  repeatCompanies: number | null;
};

export type ImportedWorkbook = {
  batchYear: number;
  drives: ImportedDrive[];
  footers: SheetFooterStats[];
  /**
   * Whether a role with no tier should get one derived from its CTC.
   *
   * True only for sources that have no tier concept at all — the 2027 sheet is
   * one flat table. False for the 2026 workbook, where a missing tier is a
   * deliberate statement: its "Internship Only" tab exists because companies
   * that never declared a CTC "can't be classified into any tiers", and its
   * summer PPOs are tracked as their own category alongside the tiers rather
   * than inside them.
   */
  deriveTierFromCtc: boolean;
};
