-- CreateEnum
CREATE TYPE "FraudIndicatorCategory" AS ENUM ('CROSS_DOC', 'FORENSIC', 'STATISTICAL', 'TEMPORAL', 'RATIO', 'ENTITY_INTEL', 'VISUAL_AI', 'NLP', 'API_VERIFY', 'RULES');

-- CreateTable
CREATE TABLE "fraud_indicators" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT,
    "category" "FraudIndicatorCategory" NOT NULL,
    "indicatorName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "evidence" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "recommendedAction" TEXT,
    "isOverridden" BOOLEAN NOT NULL DEFAULT false,
    "overriddenById" TEXT,
    "overrideJustification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submissionId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threshold_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lineOfBusiness" TEXT,
    "autoApproveBelow" INTEGER NOT NULL DEFAULT 20,
    "autoEscalateAbove" INTEGER NOT NULL DEFAULT 70,
    "siuReferralOnCritical" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "threshold_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fraud_indicators_tenantId_idx" ON "fraud_indicators"("tenantId");

-- CreateIndex
CREATE INDEX "fraud_indicators_submissionId_idx" ON "fraud_indicators"("submissionId");

-- CreateIndex
CREATE INDEX "fraud_indicators_category_idx" ON "fraud_indicators"("category");

-- CreateIndex
CREATE INDEX "fraud_indicators_severity_idx" ON "fraud_indicators"("severity");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_idx" ON "audit_logs"("tenantId");

-- CreateIndex
CREATE INDEX "audit_logs_submissionId_idx" ON "audit_logs"("submissionId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "threshold_configs_tenantId_idx" ON "threshold_configs"("tenantId");

-- AddForeignKey
ALTER TABLE "fraud_indicators" ADD CONSTRAINT "fraud_indicators_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_indicators" ADD CONSTRAINT "fraud_indicators_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_indicators" ADD CONSTRAINT "fraud_indicators_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_indicators" ADD CONSTRAINT "fraud_indicators_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threshold_configs" ADD CONSTRAINT "threshold_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
