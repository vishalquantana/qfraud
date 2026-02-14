import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, withTenantFilter } from "@/lib/rbac";
import { getUserId } from "@/lib/api-handler";

// ─── GET /api/submissions/:id ───────────────────────────

export const GET = withTenant(async (ctx, params) => {
  const { auth, tenantId } = ctx;
  const id = params?.id;
  if (!id) {
    return NextResponse.json(
      { error: "Submission ID required" },
      { status: 400 }
    );
  }

  const submission = await prisma.submission.findFirst({
    where: withTenantFilter(tenantId, { id }),
    include: {
      documents: {
        select: {
          id: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          documentType: true,
          classificationConfidence: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
      submitter: { select: { id: true, name: true, email: true } },
      assignedUnderwriter: { select: { id: true, name: true, email: true } },
      _count: { select: { fraudIndicators: true } },
    },
  });

  if (!submission) {
    return NextResponse.json(
      { error: "Submission not found" },
      { status: 404 }
    );
  }

  // Brokers can only see their own submissions
  const userId = getUserId(auth);
  if (auth.type === "user" && auth.user.role === "BROKER") {
    if (submission.submitterId !== userId) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }
  }

  return NextResponse.json({ data: submission });
});
