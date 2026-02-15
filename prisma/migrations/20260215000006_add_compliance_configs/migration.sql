-- CreateTable
CREATE TABLE "compliance_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "retentionYears" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "compliance_configs_tenantId_key" ON "compliance_configs"("tenantId");

-- AddForeignKey
ALTER TABLE "compliance_configs" ADD CONSTRAINT "compliance_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
