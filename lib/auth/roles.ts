import type { UserRole } from "@/generated/prisma/enums";

const ROLE_RANK: Record<UserRole, number> = {
  STUDENT: 0,
  VERIFIER: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

export function roleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
