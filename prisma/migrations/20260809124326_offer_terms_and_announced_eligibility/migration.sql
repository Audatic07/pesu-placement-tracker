-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "announcedCgpaCutoff" DECIMAL(4,2),
ADD COLUMN     "bondMonths" INTEGER,
ADD COLUMN     "eligibleBranches" TEXT[],
ADD COLUMN     "internshipDurationMonths" INTEGER,
ADD COLUMN     "workMode" "WorkMode" NOT NULL DEFAULT 'UNKNOWN';
