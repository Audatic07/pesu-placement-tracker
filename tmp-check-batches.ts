import "dotenv/config";
import { prisma } from "./lib/db";

async function main() {
  const batches = await prisma.batch.findMany({
    orderBy: { year: "asc" },
    select: {
      year: true,
      _count: { select: { offers: true, drives: true } },
    },
  });
  console.log(JSON.stringify(batches, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
