import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, withTenantFilter } from "@/lib/rbac";

// ─── GET /api/analytics/brokers ─────────────────────────
// Returns broker quality scores and submission history.

export const GET = withTenant(async (ctx) => {
  const { req, tenantId } = ctx;
  const url = new URL(req.url);

  // Parse date range
  const range = url.searchParams.get("range");
  const customFrom = url.searchParams.get("from");
  const customTo = url.searchParams.get("to");
  const brokerId = url.searchParams.get("brokerId"); // optional: drill-down for single broker

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

  // If brokerId specified, return detail for that broker
  if (brokerId) {
    const submissions = await prisma.submission.findMany({
      where: withTenantFilter(tenantId, {
        submitterId: brokerId,
        createdAt: dateFilter,
      }),
      select: {
        id: true,
        insuredName: true,
        lineOfBusiness: true,
        status: true,
        severity: true,
        riskScore: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Aggregate flag types for this broker
    const indicators = await prisma.fraudIndicator.groupBy({
      by: ["category", "severity"],
      where: withTenantFilter(tenantId, {
        submission: { submitterId: brokerId, createdAt: dateFilter },
      }),
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });

    // Build trend data (monthly buckets)
    const trendBuckets: Map<
      string,
      { total: number; clean: number; flagged: number }
    > = new Map();
    const flaggedSeverities = new Set(["CRITICAL", "HIGH", "MEDIUM"]);
    for (const sub of submissions) {
      const monthKey = sub.createdAt.toISOString().slice(0, 7); // YYYY-MM
      const bucket = trendBuckets.get(monthKey) ?? {
        total: 0,
        clean: 0,
        flagged: 0,
      };
      bucket.total++;
      if (sub.severity && flaggedSeverities.has(sub.severity)) {
        bucket.flagged++;
      } else {
        bucket.clean++;
      }
      trendBuckets.set(monthKey, bucket);
    }

    const trend = Array.from(trendBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }));

    return NextResponse.json({
      data: {
        submissions,
        flagTypes: indicators.map((i) => ({
          category: i.category,
          severity: i.severity,
          count: i._count.id,
        })),
        trend,
      },
    });
  }

  // Leaderboard: aggregate per broker
  const brokerUsers = await prisma.user.findMany({
    where: withTenantFilter(tenantId, { role: "BROKER" as const }),
    select: { id: true, name: true, email: true },
  });

  const brokerIds = brokerUsers.map((u) => u.id);

  const submissions = await prisma.submission.findMany({
    where: withTenantFilter(tenantId, {
      submitterId: { in: brokerIds },
      createdAt: dateFilter,
    }),
    select: {
      id: true,
      submitterId: true,
      severity: true,
      riskScore: true,
    },
  });

  // Count CRITICAL indicators per broker via submission linkage
  const criticalIndicators = await prisma.fraudIndicator.groupBy({
    by: ["submissionId"],
    where: withTenantFilter(tenantId, {
      severity: "CRITICAL" as const,
      submission: {
        submitterId: { in: brokerIds },
        createdAt: dateFilter,
      },
    }),
    _count: { id: true },
  });

  const criticalBySubmission = new Map(
    criticalIndicators.map((ci) => [ci.submissionId, ci._count.id])
  );

  // Build per-broker aggregates
  const flaggedSeverities = new Set(["CRITICAL", "HIGH", "MEDIUM"]);

  interface BrokerStats {
    brokerId: string;
    brokerName: string;
    brokerEmail: string;
    totalSubmissions: number;
    cleanCount: number;
    flaggedCount: number;
    criticalCount: number;
    cleanRate: number;
    flaggedRate: number;
    qualityScore: number;
  }

  const brokerMap = new Map<string, BrokerStats>();

  for (const user of brokerUsers) {
    brokerMap.set(user.id, {
      brokerId: user.id,
      brokerName: user.name,
      brokerEmail: user.email,
      totalSubmissions: 0,
      cleanCount: 0,
      flaggedCount: 0,
      criticalCount: 0,
      cleanRate: 0,
      flaggedRate: 0,
      qualityScore: 0,
    });
  }

  for (const sub of submissions) {
    const stats = brokerMap.get(sub.submitterId);
    if (!stats) continue;

    stats.totalSubmissions++;
    if (sub.severity && flaggedSeverities.has(sub.severity)) {
      stats.flaggedCount++;
    } else {
      stats.cleanCount++;
    }
    stats.criticalCount += criticalBySubmission.get(sub.id) ?? 0;
  }

  // Calculate rates and quality scores
  const leaderboard: BrokerStats[] = [];
  for (const stats of brokerMap.values()) {
    if (stats.totalSubmissions > 0) {
      stats.cleanRate = Math.round(
        (stats.cleanCount / stats.totalSubmissions) * 1000
      ) / 10;
      stats.flaggedRate = Math.round(
        (stats.flaggedCount / stats.totalSubmissions) * 1000
      ) / 10;
      // Quality score: 100 * cleanRate/100 with penalty for CRITICAL flags
      const criticalPenalty = Math.min(stats.criticalCount * 5, 30);
      stats.qualityScore = Math.max(
        0,
        Math.round(stats.cleanRate - criticalPenalty)
      );
    }
    leaderboard.push(stats);
  }

  // Sort by quality score descending
  leaderboard.sort((a, b) => b.qualityScore - a.qualityScore);

  return NextResponse.json({
    data: {
      period: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
      leaderboard,
    },
  });
});
