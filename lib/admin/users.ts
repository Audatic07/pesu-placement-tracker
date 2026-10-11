import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AdminError, assertAdmin, bootstrapOwnerSrn, snapshot } from "./access";

export const UserChange = z.object({
  id: z.string().min(1).max(64),
  updatedAt: z.iso.datetime(),
  role: z.enum(["STUDENT", "VERIFIER", "ADMIN", "SUPER_ADMIN"]),
  suspended: z.boolean(),
  reason: z.string().trim().min(5).max(500),
});

export async function updateUserAccess(
  actorId: string,
  input: z.infer<typeof UserChange>,
) {
  const values = UserChange.parse(input);
  return prisma.$transaction(async (tx) => {
    // Serializes last-owner checks, including concurrent demotions.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(18472012)`;
    await assertAdmin(tx, actorId, "SUPER_ADMIN");
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${values.id} FOR UPDATE`;
    const before = await tx.student.findUnique({ where: { id: values.id } });
    if (!before || before.updatedAt.toISOString() !== values.updatedAt)
      throw new AdminError("This account changed. Reload before saving.");
    if (
      before.id === actorId &&
      (values.role !== "SUPER_ADMIN" || values.suspended)
    )
      throw new AdminError(
        "An owner cannot remove their own access. Ask another owner to make this change.",
      );
    if (
      before.srn === bootstrapOwnerSrn() &&
      (values.role !== "SUPER_ADMIN" || values.suspended)
    )
      throw new AdminError(
        "This is the deployment recovery owner. Change SUPER_ADMIN_SRN in the host settings before transferring its access.",
      );
    if (
      before.role === "SUPER_ADMIN" &&
      !before.isSuspended &&
      (values.role !== "SUPER_ADMIN" || values.suspended)
    ) {
      const remaining = await tx.student.count({
        where: {
          role: "SUPER_ADMIN",
          isSuspended: false,
          id: { not: before.id },
        },
      });
      if (!remaining) throw new AdminError("Keep at least one active owner.");
    }
    const after = await tx.student.update({
      where: { id: values.id },
      data: {
        role: values.role,
        isSuspended: values.suspended,
        suspendedReason: values.suspended ? values.reason : null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action:
          before.role === after.role
            ? "UPDATE"
            : after.role === "STUDENT"
              ? "ROLE_REVOKE"
              : "ROLE_GRANT",
        entityType: "Student",
        entityId: before.id,
        before: snapshot({
          role: before.role,
          isSuspended: before.isSuspended,
        }),
        after: snapshot({ role: after.role, isSuspended: after.isSuspended }),
        summary: values.reason,
      },
    });
  });
}
