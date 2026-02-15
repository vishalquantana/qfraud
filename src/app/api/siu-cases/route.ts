import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";

// ─── GET /api/siu-cases ───────────────────────────────────
// List SIU cases with pagination and filtering.
// Accessible by SIU_INVESTIGATOR and ADMIN roles.

export const GET = withRole(
  ["SIU_INVESTIGATOR", "ADMIN"],
  async (ctx) => {
    const { req, tenantId } = ctx;
    const url = new URL(req.url);

    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10))
    );
    const skip = (page - 1) * limit;

    // Build filter
    const where: Record<string, unknown> = {};
    const status = url.searchParams.get("status");
    if (status) where.status = status;

    // Date range filter
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");
    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) createdAt.gte = new Date(dateFrom);
      if (dateTo) createdAt.lte = new Date(dateTo);
      where.createdAt = createdAt;
    }

    const [cases, total] = await Promise.all([
      prisma.sIUCase.findMany({
        where: withTenantFilter(tenantId, where),
        include: {
          submission: {
            select: {
              id: true,
              insuredName: true,
              lineOfBusiness: true,
              riskScore: true,
              severity: true,
              createdAt: true,
            },
          },
          assignedTo: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.sIUCase.count({
        where: withTenantFilter(tenantId, where),
      }),
    ]);

    // Get indicator counts per case submission
    const submissionIds = cases.map((c) => c.submissionId);
    const indicatorCounts = await prisma.fraudIndicator.groupBy({
      by: ["submissionId"],
      where: {
        tenantId,
        submissionId: { in: submissionIds },
      },
      _count: { id: true },
    });
    const countMap = new Map(
      indicatorCounts.map((ic) => [ic.submissionId, ic._count.id])
    );

    const casesWithCounts = cases.map((c) => ({
      ...c,
      indicatorCount: countMap.get(c.submissionId) ?? 0,
    }));

    return NextResponse.json({
      data: casesWithCounts,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  }
);
