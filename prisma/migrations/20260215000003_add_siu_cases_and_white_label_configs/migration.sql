-- CreateEnum
CREATE TYPE "SIUCaseStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'EVIDENCE_GATHERED', 'CONFIRMED_FRAUD', 'FALSE_POSITIVE', 'INCONCLUSIVE');

-- CreateTable
CREATE TABLE "siu_cases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "status" "SIUCaseStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT NOT NULL,
    "notes" JSONB NOT NULL DEFAULT '[]',
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "siu_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "white_label_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#1e40af',
    "secondaryColor" TEXT NOT NULL DEFAULT '#3b82f6',
    "accentColor" TEXT NOT NULL DEFAULT '#f59e0b',
    "customDomain" TEXT,
    "customEmailDomain" TEXT,
    "termsUrl" TEXT,
    "privacyUrl" TEXT,
    "footerText" TEXT,
    "supportEmail" TEXT,
    "supportPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "white_label_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "siu_cases_tenantId_idx" ON "siu_cases"("tenantId");

-- CreateIndex
CREATE INDEX "siu_cases_submissionId_idx" ON "siu_cases"("submissionId");

-- CreateIndex
CREATE INDEX "siu_cases_status_idx" ON "siu_cases"("status");

-- CreateIndex
CREATE UNIQUE INDEX "white_label_configs_tenantId_key" ON "white_label_configs"("tenantId");

-- AddForeignKey
ALTER TABLE "siu_cases" ADD CONSTRAINT "siu_cases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "siu_cases" ADD CONSTRAINT "siu_cases_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "siu_cases" ADD CONSTRAINT "siu_cases_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "white_label_configs" ADD CONSTRAINT "white_label_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
