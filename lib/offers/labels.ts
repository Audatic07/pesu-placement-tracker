import type { CompensationComponentKind, OfferCycle, RoundKind, RoundMode, WorkMode } from "@/generated/prisma/enums";

export const ROUND_LABELS: Record<RoundKind, string> = {
  PRE_PLACEMENT_TALK: "Pre-placement talk",
  RESUME_SHORTLIST: "Resume shortlist",
  ONLINE_ASSESSMENT: "Online assessment",
  GROUP_DISCUSSION: "Group discussion",
  TAKE_HOME_ASSIGNMENT: "Take-home assignment",
  HACKATHON: "Hackathon",
  TECHNICAL_INTERVIEW: "Technical interview",
  SYSTEM_DESIGN: "System design",
  MANAGERIAL: "Managerial",
  HIRING_MANAGER: "Hiring manager",
  HR: "HR",
  OTHER: "Other",
};

export const COMPONENT_LABELS: Record<CompensationComponentKind, string> = {
  FIXED_BASE: "Fixed base",
  VARIABLE_PAY: "Variable pay",
  JOINING_BONUS: "Joining bonus",
  RETENTION_BONUS: "Retention bonus",
  RELOCATION: "Relocation",
  ESOP: "ESOPs",
  RSU: "RSUs",
  GRATUITY: "Gratuity",
  PROVIDENT_FUND: "Provident fund",
  INSURANCE: "Insurance",
  PERKS: "Perks",
  OTHER: "Other",
};

export const CYCLE_LABELS: Record<OfferCycle, string> = {
  SUMMER_INTERNSHIP: "Summer internship",
  SIX_MONTH_INTERNSHIP: "Internship",
  FULL_TIME: "Full time",
};

export const MODE_LABELS: Record<RoundMode, string> = {
  ONLINE: "Online",
  IN_PERSON: "In person",
  HYBRID: "Hybrid",
  UNKNOWN: "Not recorded",
};

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  ONSITE: "In office",
  HYBRID: "Hybrid",
  REMOTE: "Fully remote",
  UNKNOWN: "Not recorded",
};
