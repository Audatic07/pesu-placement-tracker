import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { UserRole } from "@/generated/prisma/enums";
import { roleAtLeast } from "@/lib/auth/roles";

export class AdminError extends Error {}

export function bootstrapOwnerSrn(): string | null {
  return process.env.SUPER_ADMIN_SRN?.trim().toUpperCase() || null;
}

export async function assertAdmin(
  tx: Prisma.TransactionClient,
  actorId: string,
  minimum: UserRole = "ADMIN",
) {
  await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${actorId} FOR SHARE`;
  const actor = await tx.student.findUnique({ where: { id: actorId } });
  if (!actor || actor.isSuspended || !roleAtLeast(actor.role, minimum))
    throw new AdminError("Your access changed. Sign in again.");
  return actor;
}

export function snapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value));
}
