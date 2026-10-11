-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "yieldedToId" TEXT;

-- CreateIndex
CREATE INDEX "Offer_yieldedToId_idx" ON "Offer"("yieldedToId");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_yieldedToId_fkey" FOREIGN KEY ("yieldedToId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
