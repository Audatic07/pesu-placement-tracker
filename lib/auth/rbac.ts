import { cache } from "react";
import "server-only";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/auth/session";
import type { UserRole } from "@/generated/prisma/enums";
import type { StudentModel } from "@/generated/prisma/models";
import { roleAtLeast } from "./roles";
export { roleAtLeast } from "./roles";

/** Read roles and suspension state from the database so account changes take effect immediately. */

/** The signed-in student, or null. Never redirects. */
export const getCurrentStudent = cache(
  async (): Promise<StudentModel | null> => {
    const session = await readSession();
    if (!session) return null;

    const student = await prisma.student.findUnique({
      where: { id: session.sub },
    });
    if (!student) return null;

    // Suspension blocks access without deleting anything the student contributed.
    if (student.isSuspended) return null;

    return student;
  },
);

/** The signed-in student, or a redirect to login. */
export async function requireStudent(returnTo?: string): Promise<StudentModel> {
  const student = await getCurrentStudent();
  if (!student) {
    redirect(
      returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login",
    );
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
