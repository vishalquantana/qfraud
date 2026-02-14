-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PROCESSING', 'UNDER_REVIEW', 'APPROVED', 'DECLINED', 'INFO_NEEDED', 'REFERRED_TO_SIU');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'CLEAN');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('PORTAL', 'EMAIL', 'API');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('ACORD_125', 'ACORD_130', 'ACORD_140', 'LOSS_RUN', 'FINANCIAL_STATEMENT', 'COI', 'ENTITY_DOC', 'INSPECTION_PHOTO', 'MVR', 'SOV', 'SURPLUS_LINES', 'PROFESSIONAL_LICENSE', 'ENVIRONMENTAL_REPORT', 'PAYROLL_TAX', 'BROKER_SUBMISSION', 'FLEET_SCHEDULE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'CLASSIFYING', 'EXTRACTING', 'ANALYZED', 'ERROR');

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submitterId" TEXT NOT NULL,
    "insuredName" TEXT NOT NULL,
    "lineOfBusiness" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PROCESSING',
    "riskScore" INTEGER,
    "severity" "Severity",
    "channel" "Channel" NOT NULL DEFAULT 'PORTAL',
    "assignedUnderwriterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL DEFAULT 'UNKNOWN',
    "classificationConfidence" DOUBLE PRECISION,
    "extractedData" JSONB,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submissions_tenantId_idx" ON "submissions"("tenantId");

-- CreateIndex
CREATE INDEX "submissions_status_idx" ON "submissions"("status");

-- CreateIndex
CREATE INDEX "submissions_createdAt_idx" ON "submissions"("createdAt");

-- CreateIndex
CREATE INDEX "documents_tenantId_idx" ON "documents"("tenantId");

-- CreateIndex
CREATE INDEX "documents_submissionId_idx" ON "documents"("submissionId");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_createdAt_idx" ON "documents"("createdAt");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignedUnderwriterId_fkey" FOREIGN KEY ("assignedUnderwriterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
