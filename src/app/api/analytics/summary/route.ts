import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, withTenantFilter } from "@/lib/rbac";

// ─── GET /api/analytics/summary ─────────────────────────
// Returns KPI metrics for a given date range.

export const GET = withTenant(async (ctx) => {
  const { req, tenantId } = ctx;
  const url = new URL(req.url);

  // Parse date range (default: last 30 days)
  const range = url.searchParams.get("range"); // 7d, 30d, 90d, ytd, custom
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
      // 30d
      dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const dateFilter = { gte: dateFrom, lte: dateTo };

  // Fetch all submissions in the date range for the tenant
  const submissions = await prisma.submission.findMany({
    where: withTenantFilter(tenantId, { createdAt: dateFilter }),
    select: {
      id: true,
      status: true,
      severity: true,
      riskScore: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const total = submissions.length;

  // Status counts
  const statusCounts: Record<string, number> = {};
  for (const sub of submissions) {
    statusCounts[sub.status] = (statusCounts[sub.status] ?? 0) + 1;
  }

  // Severity counts (for non-processing submissions)
  const severityCounts: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    CLEAN: 0,
  };
  for (const sub of submissions) {
    if (sub.severity) {
      severityCounts[sub.severity] = (severityCounts[sub.severity] ?? 0) + 1;
    }
  }

  // Flagged = anything with severity CRITICAL, HIGH, or MEDIUM
  const flaggedCount =
    severityCounts.CRITICAL + severityCounts.HIGH + severityCounts.MEDIUM;
  const flaggedRate = total > 0 ? (flaggedCount / total) * 100 : 0;

  // Auto-approved rate
  const approvedCount = statusCounts.APPROVED ?? 0;
  const autoApprovedRate = total > 0 ? (approvedCount / total) * 100 : 0;

  // Declined rate
  const declinedCount = statusCounts.DECLINED ?? 0;
  const declinedRate = total > 0 ? (declinedCount / total) * 100 : 0;

  // SIU referral rate
  const siuCount = statusCounts.REFERRED_TO_SIU ?? 0;
  const siuReferralRate = total > 0 ? (siuCount / total) * 100 : 0;

  // Average processing time (from createdAt to updatedAt for completed submissions)
  const completedStatuses = new Set([
    "APPROVED",
    "DECLINED",
    "REFERRED_TO_SIU",
  ]);
  const completedSubs = submissions.filter((s) =>
    completedStatuses.has(s.status)
  );
  let avgProcessingTimeMs = 0;
  if (completedSubs.length > 0) {
    const totalMs = completedSubs.reduce(
      (sum, s) => sum + (s.updatedAt.getTime() - s.createdAt.getTime()),
      0
    );
    avgProcessingTimeMs = totalMs / completedSubs.length;
  }

  // Top fraud indicators (most frequently triggered in this period)
  const topIndicators = await prisma.fraudIndicator.groupBy({
    by: ["indicatorName", "severity", "category"],
    where: withTenantFilter(tenantId, { createdAt: dateFilter }),
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 10,
  });

  return NextResponse.json({
    data: {
      period: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
      totalSubmissions: total,
      flaggedRate: Math.round(flaggedRate * 10) / 10,
      autoApprovedRate: Math.round(autoApprovedRate * 10) / 10,
      declinedRate: Math.round(declinedRate * 10) / 10,
      siuReferralRate: Math.round(siuReferralRate * 10) / 10,
      avgProcessingTimeMs: Math.round(avgProcessingTimeMs),
      statusCounts,
      severityCounts,
      topIndicators: topIndicators.map((ti) => ({
        indicatorName: ti.indicatorName,
        severity: ti.severity,
        category: ti.category,
        count: ti._count.id,
      })),
    },
  });
});
