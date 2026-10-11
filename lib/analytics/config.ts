import "server-only";
import { prisma } from "@/lib/db";
import { cacheBatchRead } from "./cache";

export const getTierConfigs = cacheBatchRead("tier-configs-v1", async (year: number) => {
  const batch = await prisma.batch.findUnique({
    where: { year },
    select: { tierConfigs: {
      orderBy: { rank: "asc" },
      select: { key: true, label: true, rank: true },
    } },
  });
  return batch?.tierConfigs ?? [];
});
