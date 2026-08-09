import "server-only";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/auth/session";
import type { UserRole } from "@/generated/prisma/enums";
import type { StudentModel } from "@/generated/prisma/models";

/**
 * Authorisation guards.
 *
 * The role is re-read from the database on every guarded request rather than
 * trusted from the JWT. The JWT's copy is a hint for middleware, which cannot
 * reach the database on the edge runtime; it is never the decision. This is
 * what makes suspending an account or revoking a role take effect immediately
 * instead of whenever a 12-hour cookie happens to expire.
 */

const ROLE_RANK: Record<UserRole, number> = {
  STUDENT: 0,
  VERIFIER: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

export function roleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** The signed-in student, or null. Never redirects. */
export async function getCurrentStudent(): Promise<StudentModel | null> {
  const session = await readSession();
  if (!session) return null;

  const student = await prisma.student.findUnique({ where: { id: session.sub } });
  if (!student) return null;

  // Suspension blocks access without deleting anything the student contributed.
  if (student.isSuspended) return null;

  return student;
}

/** The signed-in student, or a redirect to login. */
export async function requireStudent(returnTo?: string): Promise<StudentModel> {
  const student = await getCurrentStudent();
  if (!student) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
  }
  return student;
}

/** The signed-in student, or a 404 for insufficient rank — so the existence of
 * admin routes is not advertised to students who probe for them. */
export async function requireRole(
  minimum: UserRole,
  returnTo?: string,
): Promise<StudentModel> {
  const student = await requireStudent(returnTo);
  if (!roleAtLeast(student.role, minimum)) {
    notFound();
  }
  return student;
}

export async function isAdmin(): Promise<boolean> {
  const student = await getCurrentStudent();
  return student !== null && roleAtLeast(student.role, "ADMIN");
}
