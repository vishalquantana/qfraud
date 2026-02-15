import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";
import { getUserId } from "@/lib/api-handler";
import { logAudit } from "@/services/audit-log";

// ─── PATCH /api/submissions/:id/indicators/:indicatorId ──
// Mark an indicator as a false positive (override)

export const PATCH = withRole(
  ["ADMIN", "SENIOR_UNDERWRITER", "UNDERWRITER", "SIU_INVESTIGATOR"],
  async (ctx, params) => {
    const { req, tenantId, auth } = ctx;
    const submissionId = params?.id;
    const indicatorId = params?.indicatorId;

    if (!submissionId || !indicatorId) {
      return NextResponse.json(
        { error: "Submission ID and Indicator ID required" },
        { status: 400 }
      );
    }

    let body: { justification?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { justification } = body;
    if (!justification?.trim()) {
      return NextResponse.json(
        { error: "Justification is required to mark an indicator as false positive" },
        { status: 400 }
      );
    }

    // Verify submission exists and belongs to tenant
    const submission = await prisma.submission.findFirst({
      where: withTenantFilter(tenantId, { id: submissionId }),
      select: { id: true },
    });

    if (!submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }

    // Find the indicator
    const indicator = await prisma.fraudIndicator.findFirst({
      where: withTenantFilter(tenantId, {
        id: indicatorId,
        submissionId,
      }),
    });

    if (!indicator) {
      return NextResponse.json(
        { error: "Indicator not found" },
        { status: 404 }
      );
    }

    const userId = getUserId(auth);

    // Toggle override: if already overridden, un-override; otherwise, override
    const newOverridden = !indicator.isOverridden;

    const updated = await prisma.fraudIndicator.update({
      where: { id: indicatorId },
      data: {
        isOverridden: newOverridden,
        overriddenById: newOverridden ? userId : null,
        overrideJustification: newOverridden ? justification.trim() : null,
      },
      include: {
        document: { select: { id: true, fileName: true, documentType: true } },
        overriddenBy: { select: { id: true, name: true } },
      },
    });

    // Audit log
    const ipAddress =
      req.headers.get("x-forwarded-for") ??
      req.headers.get("x-real-ip") ??
      null;

    await logAudit({
      tenantId,
      action: "SCORE_OVERRIDE",
      details: {
        type: "false_positive",
        indicatorId,
        indicatorName: indicator.indicatorName,
        isOverridden: newOverridden,
        justification: justification.trim(),
      },
      userId,
      submissionId,
      ipAddress,
    });

    return NextResponse.json({ data: updated });
  }
);
