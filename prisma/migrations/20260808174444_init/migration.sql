-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'VERIFIER', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "OfferCycle" AS ENUM ('SUMMER_INTERNSHIP', 'SIX_MONTH_INTERNSHIP', 'FULL_TIME');

-- CreateEnum
CREATE TYPE "OfferNature" AS ENUM ('INTERNSHIP_ONLY', 'FTE_ONLY', 'INTERNSHIP_PLUS_FTE', 'PPO_CONVERTED');

-- CreateEnum
CREATE TYPE "DriveStatus" AS ENUM ('ANNOUNCED', 'IN_PROGRESS', 'COMPLETED', 'DITCHED', 'NO_HIRES');

-- CreateEnum
CREATE TYPE "GpaCutoffKind" AS ENUM ('STRICT', 'RESUME_BASED', 'MIXED', 'NONE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RoundKind" AS ENUM ('PRE_PLACEMENT_TALK', 'RESUME_SHORTLIST', 'ONLINE_ASSESSMENT', 'GROUP_DISCUSSION', 'TAKE_HOME_ASSIGNMENT', 'HACKATHON', 'TECHNICAL_INTERVIEW', 'SYSTEM_DESIGN', 'MANAGERIAL', 'HIRING_MANAGER', 'HR', 'OTHER');

-- CreateEnum
CREATE TYPE "RoundMode" AS ENUM ('ONLINE', 'IN_PERSON', 'HYBRID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RoleFamily" AS ENUM ('SDE', 'DATA_SCIENCE', 'DATA_ENGINEERING', 'ANALYST', 'QA_SDET', 'DEVOPS_SRE', 'EMBEDDED_HARDWARE', 'CYBERSECURITY', 'PRODUCT', 'CONSULTING', 'RESEARCH', 'NON_TECH', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('ONSITE', 'HYBRID', 'REMOTE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DisclosureStatus" AS ENUM ('DISCLOSED', 'PARTIAL', 'PERFORMANCE_BASED', 'NOT_DISCLOSED');

-- CreateEnum
CREATE TYPE "CompensationComponentKind" AS ENUM ('FIXED_BASE', 'VARIABLE_PAY', 'JOINING_BONUS', 'RETENTION_BONUS', 'RELOCATION', 'ESOP', 'RSU', 'GRATUITY', 'PROVIDENT_FUND', 'INSURANCE', 'PERKS', 'OTHER');

-- CreateEnum
CREATE TYPE "AcceptanceStatus" AS ENUM ('ACCEPTED', 'DECLINED', 'PENDING', 'REVOKED');

-- CreateEnum
CREATE TYPE "NameVisibility" AS ENUM ('ANONYMOUS', 'NAMED');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('SELF_REPORTED', 'OFFICIAL_IMPORT', 'ADMIN_ENTERED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'CORROBORATED', 'ADMIN_VERIFIED', 'DISPUTED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('INFLATED_CTC', 'FAKE_OFFER', 'WRONG_COMPANY', 'DUPLICATE', 'PRIVACY_VIOLATION', 'ABUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'UPHELD', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'SOFT_DELETE', 'RESTORE', 'ROLE_GRANT', 'ROLE_REVOKE', 'REPORT_RESOLVE', 'CONFIG_CHANGE', 'IMPORT', 'LOGIN', 'EXPORT');

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "seasonStartsAt" TIMESTAMP(3),
    "seasonEndsAt" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "policyNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TierConfig" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "minCtcLpa" DECIMAL(10,2) NOT NULL,
    "maxCtcLpa" DECIMAL(10,2),

    CONSTRAINT "TierConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchBranchStrength" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "campusId" TEXT,
    "studentCount" INTEGER NOT NULL,

    CONSTRAINT "BatchBranchStrength_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionPolicy" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "maxSummerInternships" INTEGER NOT NULL DEFAULT 1,
    "maxSixMonthInternships" INTEGER NOT NULL DEFAULT 3,
    "maxFullTimePerTier" INTEGER NOT NULL DEFAULT 1,
    "maxFullTimeTotal" INTEGER NOT NULL DEFAULT 3,
    "description" TEXT,

    CONSTRAINT "SubmissionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRegimeConfig" (
    "id" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "regimeName" TEXT NOT NULL DEFAULT 'new',
    "slabs" JSONB NOT NULL,
    "standardDeductionInr" DECIMAL(12,2) NOT NULL,
    "cessPercent" DECIMAL(5,2) NOT NULL,
    "employeePfPercent" DECIMAL(5,2) NOT NULL,
    "professionalTaxInr" DECIMAL(12,2) NOT NULL,
    "rebateThresholdInr" DECIMAL(12,2),
    "notes" TEXT,

    CONSTRAINT "TaxRegimeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CpiIndex" (
    "id" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "indexValue" DECIMAL(10,3) NOT NULL,
    "source" TEXT,

    CONSTRAINT "CpiIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campus" (
    "id" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Campus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "aliases" TEXT[],

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "aliases" TEXT[],

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "srn" TEXT NOT NULL,
    "prn" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "campusId" TEXT,
    "branchId" TEXT,
    "programId" TEXT,
    "section" TEXT,
    "currentSemester" INTEGER,
    "graduationYear" INTEGER,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "isAlumni" BOOLEAN NOT NULL DEFAULT false,
    "alumniEmail" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "suspendedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "sector" TEXT,
    "isProductCompany" BOOLEAN,
    "websiteUrl" TEXT,
    "logoUrl" TEXT,
    "headquarters" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAlias" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,

    CONSTRAINT "CompanyAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyWatch" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Drive" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "cycle" "OfferCycle" NOT NULL,
    "visitNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "DriveStatus" NOT NULL DEFAULT 'ANNOUNCED',
    "pptDate" TIMESTAMP(3),
    "processStartAt" TIMESTAMP(3),
    "processEndAt" TIMESTAMP(3),
    "eligibleBranches" TEXT[],
    "eligiblePrograms" TEXT[],
    "gpaCutoffRaw" TEXT,
    "gpaCutoffNumeric" DECIMAL(4,2),
    "gpaCutoffKind" "GpaCutoffKind" NOT NULL DEFAULT 'UNKNOWN',
    "backlogPolicy" TEXT,
    "source" "RecordSource" NOT NULL DEFAULT 'SELF_REPORTED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Drive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveRole" (
    "id" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "roleFamily" "RoleFamily" NOT NULL DEFAULT 'OTHER',
    "nature" "OfferNature" NOT NULL DEFAULT 'FTE_ONLY',
    "tierKey" TEXT,
    "locations" TEXT[],
    "workMode" "WorkMode" NOT NULL DEFAULT 'UNKNOWN',
    "bondMonths" INTEGER,
    "internshipDurationMonths" INTEGER,
    "compensationId" TEXT,
    "placedInternship" INTEGER,
    "placedFte" INTEGER,
    "placedBoth" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveFunnel" (
    "id" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "eligibleCount" INTEGER,
    "registeredCount" INTEGER,
    "shortlistedForOaCount" INTEGER,
    "clearedOaCount" INTEGER,
    "shortlistedForInterview" INTEGER,
    "offersMadeCount" INTEGER,

    CONSTRAINT "DriveFunnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompensationPackage" (
    "id" TEXT NOT NULL,
    "stipendPerMonthInr" DECIMAL(12,2),
    "baseLpa" DECIMAL(10,3),
    "ctcLpa" DECIMAL(10,3),
    "disclosure" "DisclosureStatus" NOT NULL DEFAULT 'DISCLOSED',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "rawNote" TEXT,
    "firstYearCashLpa" DECIMAL(10,3),
    "steadyStateCashLpa" DECIMAL(10,3),
    "estimatedInHandMonthlyInr" DECIMAL(12,2),
    "ctcInflationRatio" DECIMAL(6,3),
    "computedForFinancialYear" TEXT,
    "computedAt" TIMESTAMP(3),

    CONSTRAINT "CompensationPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompensationComponent" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "kind" "CompensationComponentKind" NOT NULL,
    "label" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "isLpa" BOOLEAN NOT NULL DEFAULT true,
    "isOneTime" BOOLEAN NOT NULL DEFAULT false,
    "vestingYears" DECIMAL(4,2),
    "isCash" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,

    CONSTRAINT "CompensationComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "studentId" TEXT,
    "companyId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "driveRoleId" TEXT,
    "roleTitle" TEXT NOT NULL,
    "roleFamily" "RoleFamily" NOT NULL DEFAULT 'OTHER',
    "cycle" "OfferCycle" NOT NULL,
    "nature" "OfferNature" NOT NULL,
    "tierKey" TEXT,
    "branchId" TEXT,
    "compensationId" TEXT,
    "cgpa" DECIMAL(4,2),
    "cgpaBand" TEXT,
    "backlogsAtOffer" INTEGER,
    "priorInternshipCount" INTEGER,
    "hasPriorPpo" BOOLEAN,
    "locations" TEXT[],
    "offerDate" TIMESTAMP(3),
    "acceptanceStatus" "AcceptanceStatus" NOT NULL DEFAULT 'PENDING',
    "processNotes" TEXT,
    "preparationResources" TEXT,
    "difficultyRating" INTEGER,
    "nameVisibility" "NameVisibility" NOT NULL DEFAULT 'ANONYMOUS',
    "source" "RecordSource" NOT NULL DEFAULT 'SELF_REPORTED',
    "verification" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "confidenceScore" INTEGER NOT NULL DEFAULT 0,
    "isOutlierFlagged" BOOLEAN NOT NULL DEFAULT false,
    "outlierNote" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferRevision" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "editorId" TEXT,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewRound" (
    "id" TEXT NOT NULL,
    "offerId" TEXT,
    "driveRoleId" TEXT,
    "sequence" INTEGER NOT NULL,
    "kind" "RoundKind" NOT NULL,
    "mode" "RoundMode" NOT NULL DEFAULT 'UNKNOWN',
    "heldOn" TIMESTAMP(3),
    "heldUntil" TIMESTAMP(3),
    "rawSchedule" TEXT,
    "durationMinutes" INTEGER,
    "platform" TEXT,
    "topics" TEXT[],
    "difficulty" INTEGER,
    "questionsAsked" TEXT,
    "passed" BOOLEAN,
    "notes" TEXT,

    CONSTRAINT "InterviewRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "reporterId" TEXT,
    "reason" "ReportReason" NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "linkUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowEndsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Batch_year_key" ON "Batch"("year");

-- CreateIndex
CREATE INDEX "Batch_year_idx" ON "Batch"("year");

-- CreateIndex
CREATE INDEX "TierConfig_batchId_rank_idx" ON "TierConfig"("batchId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "TierConfig_batchId_key_key" ON "TierConfig"("batchId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "BatchBranchStrength_batchId_branchId_campusId_key" ON "BatchBranchStrength"("batchId", "branchId", "campusId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionPolicy_batchId_key" ON "SubmissionPolicy"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRegimeConfig_financialYear_key" ON "TaxRegimeConfig"("financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "CpiIndex_financialYear_key" ON "CpiIndex"("financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "Campus_code_key" ON "Campus"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Campus_name_key" ON "Campus"("name");

-- CreateIndex
CREATE INDEX "Campus_code_idx" ON "Campus"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE INDEX "Branch_rank_idx" ON "Branch"("rank");

-- CreateIndex
CREATE UNIQUE INDEX "Program_code_key" ON "Program"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Student_srn_key" ON "Student"("srn");

-- CreateIndex
CREATE UNIQUE INDEX "Student_prn_key" ON "Student"("prn");

-- CreateIndex
CREATE INDEX "Student_branchId_graduationYear_idx" ON "Student"("branchId", "graduationYear");

-- CreateIndex
CREATE INDEX "Student_role_idx" ON "Student"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE INDEX "Company_slug_idx" ON "Company"("slug");

-- CreateIndex
CREATE INDEX "Company_parentId_idx" ON "Company"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyAlias_normalized_key" ON "CompanyAlias"("normalized");

-- CreateIndex
CREATE INDEX "CompanyAlias_companyId_idx" ON "CompanyAlias"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyWatch_studentId_companyId_key" ON "CompanyWatch"("studentId", "companyId");

-- CreateIndex
CREATE INDEX "Drive_batchId_cycle_idx" ON "Drive"("batchId", "cycle");

-- CreateIndex
CREATE INDEX "Drive_status_idx" ON "Drive"("status");

-- CreateIndex
CREATE INDEX "Drive_pptDate_idx" ON "Drive"("pptDate");

-- CreateIndex
CREATE UNIQUE INDEX "Drive_companyId_batchId_cycle_visitNumber_key" ON "Drive"("companyId", "batchId", "cycle", "visitNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DriveRole_compensationId_key" ON "DriveRole"("compensationId");

-- CreateIndex
CREATE INDEX "DriveRole_driveId_idx" ON "DriveRole"("driveId");

-- CreateIndex
CREATE INDEX "DriveRole_roleFamily_idx" ON "DriveRole"("roleFamily");

-- CreateIndex
CREATE INDEX "DriveRole_tierKey_idx" ON "DriveRole"("tierKey");

-- CreateIndex
CREATE UNIQUE INDEX "DriveFunnel_driveId_key" ON "DriveFunnel"("driveId");

-- CreateIndex
CREATE INDEX "CompensationComponent_packageId_idx" ON "CompensationComponent"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_compensationId_key" ON "Offer"("compensationId");

-- CreateIndex
CREATE INDEX "Offer_batchId_cycle_idx" ON "Offer"("batchId", "cycle");

-- CreateIndex
CREATE INDEX "Offer_companyId_batchId_idx" ON "Offer"("companyId", "batchId");

-- CreateIndex
CREATE INDEX "Offer_studentId_idx" ON "Offer"("studentId");

-- CreateIndex
CREATE INDEX "Offer_tierKey_idx" ON "Offer"("tierKey");

-- CreateIndex
CREATE INDEX "Offer_verification_idx" ON "Offer"("verification");

-- CreateIndex
CREATE INDEX "Offer_deletedAt_idx" ON "Offer"("deletedAt");

-- CreateIndex
CREATE INDEX "Offer_offerDate_idx" ON "Offer"("offerDate");

-- CreateIndex
CREATE INDEX "OfferRevision_offerId_createdAt_idx" ON "OfferRevision"("offerId", "createdAt");

-- CreateIndex
CREATE INDEX "InterviewRound_offerId_sequence_idx" ON "InterviewRound"("offerId", "sequence");

-- CreateIndex
CREATE INDEX "InterviewRound_driveRoleId_sequence_idx" ON "InterviewRound"("driveRoleId", "sequence");

-- CreateIndex
CREATE INDEX "InterviewRound_kind_idx" ON "InterviewRound"("kind");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_offerId_idx" ON "Report"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_offerId_reporterId_reason_key" ON "Report"("offerId", "reporterId", "reason");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification"("recipientId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitBucket_key_key" ON "RateLimitBucket"("key");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowEndsAt_idx" ON "RateLimitBucket"("windowEndsAt");

-- AddForeignKey
ALTER TABLE "TierConfig" ADD CONSTRAINT "TierConfig_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchBranchStrength" ADD CONSTRAINT "BatchBranchStrength_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchBranchStrength" ADD CONSTRAINT "BatchBranchStrength_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchBranchStrength" ADD CONSTRAINT "BatchBranchStrength_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionPolicy" ADD CONSTRAINT "SubmissionPolicy_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAlias" ADD CONSTRAINT "CompanyAlias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyWatch" ADD CONSTRAINT "CompanyWatch_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyWatch" ADD CONSTRAINT "CompanyWatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drive" ADD CONSTRAINT "Drive_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drive" ADD CONSTRAINT "Drive_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveRole" ADD CONSTRAINT "DriveRole_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "Drive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveRole" ADD CONSTRAINT "DriveRole_compensationId_fkey" FOREIGN KEY ("compensationId") REFERENCES "CompensationPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveFunnel" ADD CONSTRAINT "DriveFunnel_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "Drive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationComponent" ADD CONSTRAINT "CompensationComponent_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "CompensationPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_driveRoleId_fkey" FOREIGN KEY ("driveRoleId") REFERENCES "DriveRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_compensationId_fkey" FOREIGN KEY ("compensationId") REFERENCES "CompensationPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRevision" ADD CONSTRAINT "OfferRevision_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRevision" ADD CONSTRAINT "OfferRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewRound" ADD CONSTRAINT "InterviewRound_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewRound" ADD CONSTRAINT "InterviewRound_driveRoleId_fkey" FOREIGN KEY ("driveRoleId") REFERENCES "DriveRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
