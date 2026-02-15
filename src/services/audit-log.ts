import { prisma } from "@/lib/prisma";
import { toJsonValue } from "@/lib/utils";

// ─── Action Types ────────────────────────────────────────

export type AuditAction =
  | "SUBMISSION_CREATED"
  | "DOCUMENT_UPLOADED"
  | "PROCESSING_STARTED"
  | "PROCESSING_COMPLETED"
  | "FRAUD_FLAG_RAISED"
  | "SUBMISSION_APPROVED"
  | "SUBMISSION_DECLINED"
  | "SUBMISSION_ESCALATED"
  | "SIU_REFERRAL"
  | "SCORE_OVERRIDE"
  | "THRESHOLD_CHANGED"
  | "USER_LOGIN";

// ─── logAudit ────────────────────────────────────────────

export interface LogAuditParams {
  tenantId: string;
  action: AuditAction;
  details: Record<string, unknown>;
  userId?: string | null;
  submissionId?: string | null;
  ipAddress?: string | null;
}

/**
 * Creates an immutable AuditLog record.
 * This is the single entry point for all audit logging in the system.
 */
export async function logAudit({
  tenantId,
  action,
  details,
  userId,
  submissionId,
  ipAddress,
}: LogAuditParams) {
  return prisma.auditLog.create({
    data: {
      tenantId,
      action,
      details: toJsonValue(details),
      userId: userId ?? undefined,
      submissionId: submissionId ?? undefined,
      ipAddress: ipAddress ?? undefined,
    },
  });
}
