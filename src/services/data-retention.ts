import { prisma } from "@/lib/prisma";

/**
 * Background job stub: deleteExpiredData
 *
 * Identifies records older than the tenant's configured retentionYears.
 * In MVP, this LOGS what would be deleted but does NOT actually delete records.
 *
 * In production, this would be triggered by a cron scheduler (e.g., pg_cron,
 * AWS EventBridge, or a Next.js cron route).
 */
export async function deleteExpiredData(tenantId: string): Promise<{
  tenantId: string;
  retentionYears: number;
  cutoffDate: Date;
  expiredSubmissions: number;
  expiredDocuments: number;
  expiredAuditLogs: number;
  dryRun: true;
}> {
  // Fetch tenant compliance config
  const config = await prisma.complianceConfig.findUnique({
    where: { tenantId },
    select: { retentionYears: true },
  });

  const retentionYears = config?.retentionYears ?? 5;
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - retentionYears);

  // Count records that would be purged (beyond retention period)
  const [expiredSubmissions, expiredDocuments, expiredAuditLogs] =
    await Promise.all([
      prisma.submission.count({
        where: { tenantId, createdAt: { lt: cutoffDate } },
      }),
      prisma.document.count({
        where: { tenantId, createdAt: { lt: cutoffDate } },
      }),
      prisma.auditLog.count({
        where: { tenantId, createdAt: { lt: cutoffDate } },
      }),
    ]);

  // MVP: Log what WOULD be deleted, but do not actually delete
  console.log(
    `[DATA RETENTION] Tenant ${tenantId}: ` +
      `retention=${retentionYears}yr, cutoff=${cutoffDate.toISOString()}, ` +
      `would purge: ${expiredSubmissions} submissions, ${expiredDocuments} documents, ${expiredAuditLogs} audit logs`
  );

  return {
    tenantId,
    retentionYears,
    cutoffDate,
    expiredSubmissions,
    expiredDocuments,
    expiredAuditLogs,
    dryRun: true,
  };
}

/**
 * Run data retention check across all tenants.
 * Intended to be called by a scheduled cron job.
 */
export async function deleteExpiredDataAllTenants(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true },
  });

  for (const tenant of tenants) {
    try {
      const result = await deleteExpiredData(tenant.id);
      const total =
        result.expiredSubmissions +
        result.expiredDocuments +
        result.expiredAuditLogs;
      if (total > 0) {
        console.log(
          `[DATA RETENTION] ${tenant.name}: ${total} total records flagged for purge (dry run)`
        );
      }
    } catch (error) {
      console.error(
        `[DATA RETENTION] Error processing tenant ${tenant.name}:`,
        error
      );
    }
  }
}
