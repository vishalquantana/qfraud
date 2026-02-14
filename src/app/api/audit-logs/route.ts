import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";

// ─── GET /api/audit-logs ─────────────────────────────────

export const GET = withRole(
  ["ADMIN", "COMPLIANCE_OFFICER"],
  async (ctx) => {
    const { req, tenantId } = ctx;
    const url = new URL(req.url);

    // Pagination
    const page = Math.max(
      1,
      parseInt(url.searchParams.get("page") ?? "1", 10),
    );
    const limit = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)),
    );
    const skip = (page - 1) * limit;

    // Build filter
    const where: Record<string, unknown> = {};

    const action = url.searchParams.get("action");
    if (action) where.action = action;

    const submissionId = url.searchParams.get("submissionId");
    if (submissionId) where.submissionId = submissionId;

    const userId = url.searchParams.get("userId");
    if (userId) where.userId = userId;

    // Date range
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    if (startDate || endDate) {
      const createdAt: Record<string, Date> = {};
      if (startDate) createdAt.gte = new Date(startDate);
      if (endDate) createdAt.lte = new Date(endDate);
      where.createdAt = createdAt;
    }

    const tenantWhere = withTenantFilter(tenantId, where);

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: tenantWhere,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where: tenantWhere }),
    ]);

    return NextResponse.json({
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  },
);
