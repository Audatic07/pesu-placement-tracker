import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness probe for uptime monitoring. Deliberately public and deliberately
 * uninformative on failure — a health endpoint should not narrate the database
 * topology to whoever curls it.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", time: new Date().toISOString() });
  } catch {
    return NextResponse.json(
      { status: "degraded", time: new Date().toISOString() },
      { status: 503 },
    );
  }
}
