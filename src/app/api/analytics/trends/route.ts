import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, withTenantFilter } from "@/lib/rbac";

// ─── GET /api/analytics/trends ──────────────────────────
// Returns time-series data for trend charts.

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

  // Determine grouping granularity: daily for <=30d, weekly for >30d
  const daysDiff =
    (dateTo.getTime() - dateFrom.getTime()) / (24 * 60 * 60 * 1000);
  const granularity = daysDiff <= 30 ? "daily" : "weekly";

  // Fetch submissions in range
  const submissions = await prisma.submission.findMany({
    where: withTenantFilter(tenantId, {
      createdAt: { gte: dateFrom, lte: dateTo },
    }),
    select: {
      id: true,
      severity: true,
      createdAt: true,
    },
  });

  // Build time-series buckets
  const buckets: Map<string, { total: number; flagged: number; clean: number }> =
    new Map();

  // Initialize all buckets in the range
  const current = new Date(dateFrom);
  while (current <= dateTo) {
    const key = getBucketKey(current, granularity);
    if (!buckets.has(key)) {
      buckets.set(key, { total: 0, flagged: 0, clean: 0 });
    }
    // Advance by 1 day or 7 days
    if (granularity === "daily") {
      current.setDate(current.getDate() + 1);
    } else {
      current.setDate(current.getDate() + 7);
    }
  }

  // Populate buckets
  const flaggedSeverities = new Set(["CRITICAL", "HIGH", "MEDIUM"]);
  for (const sub of submissions) {
    const key = getBucketKey(sub.createdAt, granularity);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.total++;
      if (sub.severity && flaggedSeverities.has(sub.severity)) {
        bucket.flagged++;
      } else {
        bucket.clean++;
      }
    }
  }

  // Convert to sorted array
  const trendData = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      ...data,
    }));

  return NextResponse.json({
    data: {
      period: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
      granularity,
      trends: trendData,
    },
  });
});

function getBucketKey(date: Date, granularity: string): string {
  if (granularity === "daily") {
    return date.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  // Weekly: use the Monday of the week
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}
