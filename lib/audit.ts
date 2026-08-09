import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import type { AuditAction } from "@/generated/prisma/enums";

/**
 * Append-only audit trail.
 *
 * Every consequential action lands here: role grants, report resolutions,
 * offer edits and removals, config changes, imports. It is the record that
 * makes an admin's keep-or-remove decision reviewable years after the admin
 * who made it has graduated.
 *
 * Two rules:
 *   - Rows are never updated or deleted. There is no code path that does so.
 *   - A failure to write the log must never take down the action it describes,
 *     but it must be loud, because a silent gap in an audit trail is worse
 *     than a noisy one.
 */

export type AuditInput = {
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  summary?: string;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  let ipAddress: string | null = null;
  let userAgent: string | null = null;

  try {
    const headerList = await headers();
    // x-forwarded-for is a list when proxies chain; the first entry is the client.
    ipAddress =
      headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      headerList.get("x-real-ip") ??
      null;
    userAgent = headerList.get("user-agent");
  } catch {
    // Outside a request context (a script, a cron job). Not an error.
  }

  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        before: toJson(input.before),
        after: toJson(input.after),
        summary: input.summary ?? null,
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    console.error(
      `[audit] FAILED to record ${input.action} on ${input.entityType}${
        input.entityId ? `:${input.entityId}` : ""
      }`,
      error,
    );
  }
}

/**
 * Prisma's Json column rejects `undefined`, and we never want a stray class
 * instance or Decimal in the trail — the point of a snapshot is that it still
 * reads correctly when the code that produced it is long gone.
 */
function toJson(value: unknown): object | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as object;
}
