import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, withTenantFilter } from "@/lib/rbac";
import type { FraudIndicatorCategory, SIUCaseStatus } from "@/generated/prisma/client";

// ─── GET /api/analytics/compliance ──────────────────────
// Returns compliance metrics, antifraud plan status, data retention info, and estimated savings.

export const GET = withTenant(async (ctx) => {
  const { req, tenantId } = ctx;
  const url = new URL(req.url);

  // Parse date range
  const range = url.searchParams.get("range");
  const customFrom = url.searchParams.get("from");
  const customTo = url.searchParams.get("to");

  const now = new Date();
  let dateFrom: Date;
  const dateTo = customTo ? new Date(customTo) : now;

  switch (range) {
    case "7d":
      dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "90d":
      dateFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case "ytd":
      dateFrom = new Date(now.getFullYear(), 0, 1);
      break;
    case "custom":
      dateFrom = customFrom
        ? new Date(customFrom)
        : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const dateFilter = { gte: dateFrom, lte: dateTo };

  // ─── Antifraud Plan Checklist ───────────────────────────
  // Check which detection categories have indicators (= implemented)
  const implementedCategories = await prisma.fraudIndicator.groupBy({
    by: ["category"],
    where: withTenantFilter(tenantId, {}),
  });

  const allCategories: FraudIndicatorCategory[] = [
    "CROSS_DOC",
    "FORENSIC",
    "STATISTICAL",
    "TEMPORAL",
    "RATIO",
    "ENTITY_INTEL",
    "VISUAL_AI",
    "NLP",
    "API_VERIFY",
    "RULES",
  ];
  const implementedSet = new Set<FraudIndicatorCategory>(implementedCategories.map((c) => c.category));

  const indicatorChecklist = allCategories.map((cat) => ({
    category: cat,
    implemented: implementedSet.has(cat),
  }));

  // Audit trail completeness: count audit log entries in period vs submissions
  const [auditLogCount, submissionCount] = await Promise.all([
    prisma.auditLog.count({
      where: withTenantFilter(tenantId, { createdAt: dateFilter }),
    }),
    prisma.submission.count({
      where: withTenantFilter(tenantId, { createdAt: dateFilter }),
    }),
  ]);

  // Expect ~3 audit logs per submission minimum (created, processing, completed)
  const expectedAuditLogs = submissionCount * 3;
  const auditTrailCompleteness =
    expectedAuditLogs > 0
      ? Math.min(100, Math.round((auditLogCount / expectedAuditLogs) * 100))
      : 100;

  // Reporting status: check if SIU cases have reports generated
  const [siuCaseCount, siuCasesWithReports] = await Promise.all([
    prisma.sIUCase.count({
      where: withTenantFilter(tenantId, { createdAt: dateFilter }),
    }),
    prisma.sIUCase.count({
      where: withTenantFilter(tenantId, {
        createdAt: dateFilter,
        status: { in: ["CONFIRMED_FRAUD", "FALSE_POSITIVE", "INCONCLUSIVE"] as SIUCaseStatus[] },
      }),
    }),
  ]);

  const reportingRate =
    siuCaseCount > 0
      ? Math.round((siuCasesWithReports / siuCaseCount) * 100)
      : 100;

  // ─── Data Retention Status ──────────────────────────────
  const [oldestSubmission, newestSubmission, totalRecords, complianceConfig] =
    await Promise.all([
      prisma.submission.findFirst({
        where: withTenantFilter(tenantId, {}),
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      prisma.submission.findFirst({
        where: withTenantFilter(tenantId, {}),
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.submission.count({
        where: withTenantFilter(tenantId, {}),
      }),
      prisma.complianceConfig.findUnique({
        where: { tenantId },
        select: { retentionYears: true },
      }),
    ]);

  // Use tenant-configured retention, default 5 years
  const retentionYears = complianceConfig?.retentionYears ?? 5;
  const retentionCutoff = new Date(now);
  retentionCutoff.setFullYear(retentionCutoff.getFullYear() - retentionYears);

  const recordsBeyondRetention = await prisma.submission.count({
    where: withTenantFilter(tenantId, {
      createdAt: { lt: retentionCutoff },
    }),
  });

  // Data age distribution (by year)
  const allSubmissions = await prisma.submission.findMany({
    where: withTenantFilter(tenantId, {}),
    select: { createdAt: true },
  });

  const ageDistribution: Record<string, number> = {};
  for (const sub of allSubmissions) {
    const year = sub.createdAt.getFullYear().toString();
    ageDistribution[year] = (ageDistribution[year] ?? 0) + 1;
  }

  // ─── Estimated Savings ─────────────────────────────────
  // Configurable average fraud loss amount (default $75,000)
  const avgFraudLossAmount = 75000;

  // Count CRITICAL flagged submissions in period
  const criticalFlaggedCount = await prisma.submission.count({
    where: withTenantFilter(tenantId, {
      createdAt: dateFilter,
      severity: "CRITICAL" as const,
    }),
  });

  const estimatedSavings = criticalFlaggedCount * avgFraudLossAmount;

  // Also count declined submissions (direct loss avoidance)
  const declinedCount = await prisma.submission.count({
    where: withTenantFilter(tenantId, {
      createdAt: dateFilter,
      status: "DECLINED" as const,
    }),
  });

  // ─── Fraud Warning Compliance ──────────────────────────
  // Check if any notifications were sent (proxy for fraud warning compliance)
  const fraudWarningAuditLogs = await prisma.auditLog.count({
    where: withTenantFilter(tenantId, {
      action: "SUBMISSION_CREATED",
      createdAt: dateFilter,
    }),
  });

  const fraudWarningCompliance =
    submissionCount > 0
      ? Math.min(
          100,
          Math.round((fraudWarningAuditLogs / submissionCount) * 100)
        )
      : 100;

  return NextResponse.json({
    data: {
      period: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
      antifraudPlan: {
        indicatorChecklist,
        implementedCount: implementedSet.size,
        totalCategories: allCategories.length,
        auditTrailCompleteness,
        reportingRate,
        fraudWarningCompliance,
      },
      dataRetention: {
        retentionYears,
        totalRecords,
        oldestRecord: oldestSubmission?.createdAt?.toISOString() ?? null,
        newestRecord: newestSubmission?.createdAt?.toISOString() ?? null,
        recordsBeyondRetention,
        ageDistribution,
      },
      estimatedSavings: {
        criticalFlaggedCount,
        declinedCount,
        avgFraudLossAmount,
        totalEstimatedSavings: estimatedSavings,
      },
    },
  });
});
