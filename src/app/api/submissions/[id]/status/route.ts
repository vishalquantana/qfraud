import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";
import { getUserId } from "@/lib/api-handler";
import { logAudit } from "@/services/audit-log";
import { sendNotification } from "@/services/notification";
import type { Role } from "@/generated/prisma/client";

// ─── Valid Status Transitions ────────────────────────────

const VALID_ACTIONS: Record<
  string,
  {
    status: "APPROVED" | "DECLINED" | "INFO_NEEDED" | "REFERRED_TO_SIU";
    requiresJustification: boolean;
  }
> = {
  approve: { status: "APPROVED", requiresJustification: false },
  decline: { status: "DECLINED", requiresJustification: true },
  "request-info": { status: "INFO_NEEDED", requiresJustification: false },
  "refer-to-siu": { status: "REFERRED_TO_SIU", requiresJustification: false },
};

// ─── PATCH /api/submissions/:id/status ───────────────────

export const PATCH = withRole(
  ["ADMIN", "SENIOR_UNDERWRITER", "UNDERWRITER", "SIU_INVESTIGATOR"],
  async (ctx, params) => {
    const { req, auth, tenantId } = ctx;
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Submission ID required" },
        { status: 400 }
      );
    }

    let body: {
      action?: string;
      justification?: string;
      infoNeededDetails?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { action, justification, infoNeededDetails } = body;
    if (!action || !VALID_ACTIONS[action]) {
      return NextResponse.json(
        {
          error: `Invalid action. Must be one of: ${Object.keys(VALID_ACTIONS).join(", ")}`,
        },
        { status: 400 }
      );
    }

    const actionConfig = VALID_ACTIONS[action];

    // Require justification for decline
    if (actionConfig.requiresJustification && !justification?.trim()) {
      return NextResponse.json(
        { error: "Justification is required for this action" },
        { status: 400 }
      );
    }

    // Find the submission
    const submission = await prisma.submission.findFirst({
      where: withTenantFilter(tenantId, { id }),
      include: {
        submitter: { select: { email: true, name: true } },
      },
    });

    if (!submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }

    const userId = getUserId(auth);
    const previousStatus = submission.status;

    // Update submission status
    const updated = await prisma.submission.update({
      where: { id },
      data: { status: actionConfig.status },
    });

    // Create SIU case if referring to SIU
    if (actionConfig.status === "REFERRED_TO_SIU") {
      // Find an SIU investigator to assign
      const siuInvestigator = await prisma.user.findFirst({
        where: withTenantFilter(tenantId, {
          role: "SIU_INVESTIGATOR" as Role,
          isActive: true,
        }),
      });

      if (siuInvestigator) {
        await prisma.sIUCase.create({
          data: {
            tenantId,
            submissionId: id,
            status: "OPEN",
            assignedToId: siuInvestigator.id,
          },
        });
      }
    }

    // Audit log
    const auditAction =
      actionConfig.status === "APPROVED"
        ? "SUBMISSION_APPROVED"
        : actionConfig.status === "DECLINED"
          ? "SUBMISSION_DECLINED"
          : actionConfig.status === "REFERRED_TO_SIU"
            ? "SIU_REFERRAL"
            : "SUBMISSION_ESCALATED";

    const ipAddress =
      req.headers.get("x-forwarded-for") ??
      req.headers.get("x-real-ip") ??
      null;

    await logAudit({
      tenantId,
      action: auditAction,
      details: {
        previousStatus,
        newStatus: actionConfig.status,
        action,
        justification: justification?.trim() ?? null,
        infoNeededDetails: infoNeededDetails?.trim() ?? null,
      },
      userId,
      submissionId: id,
      ipAddress,
    });

    // Send notifications
    try {
      if (actionConfig.status === "APPROVED" && submission.submitter.email) {
        await sendNotification(
          "SUBMISSION_APPROVED",
          submission.submitter.email,
          tenantId,
          {
            submissionId: id,
            insuredName: submission.insuredName,
          }
        );
      } else if (
        actionConfig.status === "DECLINED" &&
        submission.submitter.email
      ) {
        await sendNotification(
          "SUBMISSION_DECLINED",
          submission.submitter.email,
          tenantId,
          {
            submissionId: id,
            insuredName: submission.insuredName,
          }
        );
      } else if (
        actionConfig.status === "INFO_NEEDED" &&
        submission.submitter.email
      ) {
        await sendNotification(
          "INFO_NEEDED",
          submission.submitter.email,
          tenantId,
          {
            submissionId: id,
            insuredName: submission.insuredName,
            infoNeededDetails: infoNeededDetails?.trim(),
          }
        );
      } else if (actionConfig.status === "REFERRED_TO_SIU") {
        await sendNotification(
          "ESCALATION_NOTICE",
          submission.submitter.email,
          tenantId,
          {
            submissionId: id,
            insuredName: submission.insuredName,
          }
        );
      }
    } catch {
      // Notification failures should not break the status update
    }

    return NextResponse.json({
      data: {
        id: updated.id,
        status: updated.status,
        previousStatus,
      },
    });
  }
);
