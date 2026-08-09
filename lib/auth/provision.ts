import "server-only";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { ensureBatch } from "@/lib/policy/batch";
import {
  graduationYearFromSemester,
  graduationYearFromSrn,
  parseSemester,
  parseSrn,
} from "@/lib/auth/srn";
import type { PesuClassInfo, ResolvedPesuProfile } from "@/lib/auth/pesu";
import type { StudentModel } from "@/generated/prisma/models";

/**
 * Turns a verified PESU profile into a local Student row.
 *
 * The profile is a *snapshot*, refreshed on every login. Section and semester
 * change term to term; branch occasionally gets corrected. Re-reading it each
 * time keeps the record current without anyone maintaining it by hand.
 *
 * What is deliberately NOT stored: the password, in any form. See lib/auth/pesu.ts.
 */

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Matches PESU's long-form branch name ("Computer Science and Engineering")
 * against our short codes and their aliases.
 */
async function resolveBranchId(
  branchName: string | undefined,
  srnBranchCode: string | undefined,
): Promise<string | null> {
  const branches = await prisma.branch.findMany();

  if (branchName) {
    const target = normalize(branchName);
    const byName = branches.find(
      (branch) =>
        normalize(branch.name) === target ||
        normalize(branch.code) === target ||
        branch.aliases.some((alias) => normalize(alias) === target),
    );
    if (byName) return byName.id;

    // Fall back to a containment match: PESU sometimes appends a specialisation
    // in parentheses that none of our aliases carry verbatim.
    const byContains = branches.find(
      (branch) =>
        target.includes(normalize(branch.name)) ||
        branch.aliases.some(
          (alias) => alias.length > 3 && target.includes(normalize(alias)),
        ),
    );
    if (byContains) return byContains.id;
  }

  // Last resort: the two-to-four letter code embedded in the SRN. "CS" -> CSE,
  // "AM" -> AIML, "EC" -> ECE.
  if (srnBranchCode) {
    const code = normalize(srnBranchCode);
    const srnCodeMap: Record<string, string> = {
      cs: "CSE",
      am: "AIML",
      ai: "AIML",
      aiml: "AIML",
      ec: "ECE",
      ee: "EEE",
      me: "MECH",
      bt: "BT",
    };
    const mapped = srnCodeMap[code];
    if (mapped) {
      const branch = branches.find((item) => item.code === mapped);
      if (branch) return branch.id;
    }
  }

  return null;
}

async function resolveProgramId(
  programName: string | undefined,
  srnLevel: "UG" | "PG" | undefined,
): Promise<string | null> {
  const programs = await prisma.program.findMany();

  if (programName) {
    const target = normalize(programName);
    const match = programs.find(
      (program) =>
        normalize(program.code) === target ||
        normalize(program.name) === target ||
        program.aliases.some((alias) => normalize(alias) === target),
    );
    if (match) return match.id;
  }

  // UG/PG from the SRN is a coarse but reliable fallback.
  if (srnLevel) {
    const fallback = programs.find(
      (program) => program.code === (srnLevel === "PG" ? "MTECH" : "BTECH"),
    );
    if (fallback) return fallback.id;
  }

  return null;
}

export async function provisionStudent(
  profile: ResolvedPesuProfile,
  classInfo: PesuClassInfo | null,
  now: Date = new Date(),
): Promise<StudentModel> {
  const srn = profile.srn.trim().toUpperCase();
  const parsedSrn = parseSrn(srn);

  const branchId = await resolveBranchId(
    profile.branch ?? classInfo?.branch,
    parsedSrn?.branchCode,
  );
  const programId = await resolveProgramId(profile.program, parsedSrn?.level);

  const campusId = profile.campusCode
    ? ((await prisma.campus.findUnique({ where: { code: profile.campusCode } }))?.id ??
      null)
    : parsedSrn
      ? ((await prisma.campus.findUnique({ where: { code: parsedSrn.campusCode } }))
          ?.id ?? null)
      : null;

  const program = programId
    ? await prisma.program.findUnique({ where: { id: programId } })
    : null;

  const semester = parseSemester(profile.semester ?? classInfo?.semester);

  // The SRN's admission year is the primary signal; the reported semester is
  // the fallback. See lib/auth/srn.ts for why.
  const graduationYear =
    graduationYearFromSrn(srn, program?.durationYears ?? 4) ??
    (semester !== null
      ? graduationYearFromSemester(semester, program?.totalSemesters ?? 8, now)
      : null);

  if (graduationYear !== null) {
    await ensureBatch(graduationYear);
  }

  const shared = {
    name: profile.name.trim(),
    email: profile.email?.trim() || null,
    phone: profile.phone?.trim() || null,
    prn: profile.prn?.trim().toUpperCase() || null,
    campusId,
    branchId,
    programId,
    section: (profile.section ?? classInfo?.section)?.trim() || null,
    currentSemester: semester,
    graduationYear,
    lastLoginAt: now,
  };

  const existing = await prisma.student.findUnique({ where: { srn } });

  if (existing) {
    return prisma.student.update({ where: { srn }, data: shared });
  }

  const created = await prisma.student.create({ data: { srn, ...shared } });

  await recordAudit({
    actorId: created.id,
    action: "CREATE",
    entityType: "Student",
    entityId: created.id,
    summary: `First login: ${srn} provisioned (batch ${graduationYear ?? "unknown"}).`,
  });

  return created;
}

/**
 * Promotes the bootstrap admin.
 *
 * The very first administrator cannot be granted by an existing administrator,
 * so their SRN is named in the environment and promoted the first time they
 * log in. Once promoted, the variable can be removed — the role lives in the
 * database, and further admins are granted through the console.
 */
export async function applyBootstrapAdmin(
  student: StudentModel,
): Promise<StudentModel> {
  const configured = process.env.SUPER_ADMIN_SRN?.trim().toUpperCase();
  if (!configured || configured !== student.srn) return student;
  if (student.role === "SUPER_ADMIN") return student;

  const promoted = await prisma.student.update({
    where: { id: student.id },
    data: { role: "SUPER_ADMIN" },
  });

  await recordAudit({
    actorId: student.id,
    action: "ROLE_GRANT",
    entityType: "Student",
    entityId: student.id,
    before: { role: student.role },
    after: { role: "SUPER_ADMIN" },
    summary: `Bootstrap promotion from SUPER_ADMIN_SRN for ${student.srn}.`,
  });

  return promoted;
}
