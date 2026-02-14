import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";

// ─── GET /api/submissions/:id/indicators ─────────────────

export const GET = withRole(
  [
    "ADMIN",
    "SENIOR_UNDERWRITER",
    "UNDERWRITER",
    "SIU_INVESTIGATOR",
    "COMPLIANCE_OFFICER",
  ],
  async (ctx, params) => {
    const { req, tenantId } = ctx;
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Submission ID required" },
        { status: 400 }
      );
    }

    // Verify submission exists and belongs to tenant
    const submission = await prisma.submission.findFirst({
      where: withTenantFilter(tenantId, { id }),
      select: { id: true },
    });

    if (!submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }

    const url = new URL(req.url);
    const category = url.searchParams.get("category");
    const severity = url.searchParams.get("severity");

    const where: Record<string, unknown> = { submissionId: id };
    if (category) where.category = category;
    if (severity) where.severity = severity;

    const indicators = await prisma.fraudIndicator.findMany({
      where: withTenantFilter(tenantId, where),
      include: {
        document: { select: { id: true, fileName: true, documentType: true } },
        overriddenBy: { select: { id: true, name: true } },
      },
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ data: indicators });
  }
);
