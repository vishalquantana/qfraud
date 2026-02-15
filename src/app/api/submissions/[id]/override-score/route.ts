import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";
import { getUserId } from "@/lib/api-handler";
import { logAudit } from "@/services/audit-log";
import { overrideScoreSchema } from "@/lib/validation-schemas";

// ─── PATCH /api/submissions/:id/override-score ───────────
// Override the risk score (SENIOR_UNDERWRITER and ADMIN only)

export const PATCH = withRole(
  ["ADMIN", "SENIOR_UNDERWRITER"],
  async (ctx, params) => {
    const { req, tenantId, auth } = ctx;
    const submissionId = params?.id;

    if (!submissionId) {
      return NextResponse.json(
        { error: "Submission ID required" },
        { status: 400 }
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = overrideScoreSchema.safeParse(rawBody);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      const field = firstError?.path?.[0];
      if (field === "justification") {
        return NextResponse.json(
          { error: "Justification is required for score override" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: "Score is required and must be a number between 0 and 100" },
        { status: 400 }
      );
    }

    const { score, justification } = parsed.data;

    // Find the submission
    const submission = await prisma.submission.findFirst({
      where: withTenantFilter(tenantId, { id: submissionId }),
    });

    if (!submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }

    const previousScore = submission.riskScore;

    // Determine new severity based on overridden score
    let newSeverity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "CLEAN";
    if (score >= 85) {
      newSeverity = "CRITICAL";
    } else if (score >= 60) {
      newSeverity = "HIGH";
    } else if (score >= 35) {
      newSeverity = "MEDIUM";
    } else if (score > 0) {
      newSeverity = "LOW";
    } else {
      newSeverity = "CLEAN";
    }

    // Update submission
    const updated = await prisma.submission.update({
      where: { id: submissionId },
      data: {
        riskScore: score,
        severity: newSeverity,
      },
    });

    // Audit log
    const userId = getUserId(auth);
    const ipAddress =
      req.headers.get("x-forwarded-for") ??
      req.headers.get("x-real-ip") ??
      null;

    await logAudit({
      tenantId,
      action: "SCORE_OVERRIDE",
      details: {
        type: "score_override",
        previousScore,
        newScore: score,
        previousSeverity: submission.severity,
        newSeverity,
        justification: justification.trim(),
      },
      userId,
      submissionId,
      ipAddress,
    });

    return NextResponse.json({
      data: {
        id: updated.id,
        riskScore: updated.riskScore,
        severity: updated.severity,
        previousScore,
      },
    });
  }
);
