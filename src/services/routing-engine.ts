import { prisma } from "@/lib/prisma";

/**
 * Routes a submission based on its risk score and the tenant's threshold configuration.
 *
 * Routing rules:
 * - Score below autoApproveBelow AND no MEDIUM+ indicators → APPROVED
 * - Score above autoEscalateAbove OR any CRITICAL indicator → UNDER_REVIEW (assigned to senior underwriter)
 * - siuReferralOnCritical enabled AND forged/fabricated document indicator present → REFERRED_TO_SIU (auto-create SIU case)
 * - All others → UNDER_REVIEW for standard underwriter review
 */
export async function routeSubmission(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
  });

  const { tenantId, lineOfBusiness, riskScore } = submission;
  const score = riskScore ?? 0;

  // Load threshold config: prefer per-LOB override, fallback to global (lineOfBusiness = null)
  const thresholdConfig = await findThresholdConfig(tenantId, lineOfBusiness);

  const {
    autoApproveBelow,
    autoEscalateAbove,
    siuReferralOnCritical,
  } = thresholdConfig;

  // Fetch non-overridden indicators for this submission
  const indicators = await prisma.fraudIndicator.findMany({
    where: {
      submissionId,
      tenantId,
      isOverridden: false,
    },
  });

  const hasCritical = indicators.some((i) => i.severity === "CRITICAL");
  const hasMediumOrAbove = indicators.some(
    (i) =>
      i.severity === "CRITICAL" ||
      i.severity === "HIGH" ||
      i.severity === "MEDIUM"
  );

  // Check for forged/fabricated document indicators (forensic category indicators suggesting forgery)
  const hasForgedDocumentIndicator = indicators.some(
    (i) =>
      i.category === "FORENSIC" &&
      i.severity === "CRITICAL"
  );

  // Routing decision
  // Priority 1: SIU referral for forged/fabricated documents
  if (siuReferralOnCritical && hasForgedDocumentIndicator) {
    await referToSIU(submission, tenantId, submissionId);
    return;
  }

  // Priority 2: Auto-approve clean/low-risk submissions
  if (score < autoApproveBelow && !hasMediumOrAbove) {
    await autoApprove(tenantId, submissionId);
    return;
  }

  // Priority 3: Escalate high-risk submissions to senior underwriter
  if (score > autoEscalateAbove || hasCritical) {
    await escalateToSeniorUnderwriter(tenantId, submissionId);
    return;
  }

  // Default: assign to standard underwriter review
  await assignToUnderwriterReview(tenantId, submissionId);
}

async function findThresholdConfig(
  tenantId: string,
  lineOfBusiness: string | null
) {
  // Try LOB-specific config first
  if (lineOfBusiness) {
    const lobConfig = await prisma.thresholdConfig.findFirst({
      where: { tenantId, lineOfBusiness },
    });
    if (lobConfig) return lobConfig;
  }

  // Fallback to global config (lineOfBusiness = null)
  const globalConfig = await prisma.thresholdConfig.findFirst({
    where: { tenantId, lineOfBusiness: null },
  });

  if (globalConfig) return globalConfig;

  // Ultimate fallback: default values
  return {
    autoApproveBelow: 20,
    autoEscalateAbove: 70,
    siuReferralOnCritical: true,
  };
}

async function autoApprove(
  tenantId: string,
  submissionId: string
): Promise<void> {
  await prisma.submission.update({
    where: { id: submissionId },
    data: { status: "APPROVED" },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      submissionId,
      action: "SUBMISSION_APPROVED",
      details: JSON.parse(
        JSON.stringify({
          reason: "Auto-approved: score below threshold with no medium or higher indicators",
          routing: "automatic",
        })
      ),
    },
  });
}

async function escalateToSeniorUnderwriter(
  tenantId: string,
  submissionId: string
): Promise<void> {
  // Find a senior underwriter for assignment
  const seniorUnderwriter = await prisma.user.findFirst({
    where: {
      tenantId,
      role: "SENIOR_UNDERWRITER",
      isActive: true,
    },
  });

  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      status: "UNDER_REVIEW",
      assignedUnderwriterId: seniorUnderwriter?.id ?? null,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      submissionId,
      action: "SUBMISSION_ESCALATED",
      details: JSON.parse(
        JSON.stringify({
          reason:
            "Escalated: score above threshold or critical indicators present",
          routing: "automatic",
          assignedTo: seniorUnderwriter?.id ?? null,
          assignedToName: seniorUnderwriter?.name ?? null,
        })
      ),
    },
  });
}

async function referToSIU(
  submission: { assignedUnderwriterId: string | null },
  tenantId: string,
  submissionId: string
): Promise<void> {
  // Find an SIU investigator for assignment
  const siuInvestigator = await prisma.user.findFirst({
    where: {
      tenantId,
      role: "SIU_INVESTIGATOR",
      isActive: true,
    },
  });

  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      status: "REFERRED_TO_SIU",
    },
  });

  // Auto-create SIU case
  if (siuInvestigator) {
    await prisma.sIUCase.create({
      data: {
        tenantId,
        submissionId,
        status: "OPEN",
        assignedToId: siuInvestigator.id,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      tenantId,
      submissionId,
      action: "SIU_REFERRAL",
      details: JSON.parse(
        JSON.stringify({
          reason:
            "Referred to SIU: forged or fabricated document indicator detected",
          routing: "automatic",
          assignedTo: siuInvestigator?.id ?? null,
          assignedToName: siuInvestigator?.name ?? null,
          siuCaseCreated: !!siuInvestigator,
        })
      ),
    },
  });
}

async function assignToUnderwriterReview(
  tenantId: string,
  submissionId: string
): Promise<void> {
  // Find an available underwriter for assignment
  const underwriter = await prisma.user.findFirst({
    where: {
      tenantId,
      role: { in: ["UNDERWRITER", "SENIOR_UNDERWRITER"] },
      isActive: true,
    },
  });

  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      status: "UNDER_REVIEW",
      assignedUnderwriterId: underwriter?.id ?? null,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      submissionId,
      action: "SUBMISSION_ESCALATED",
      details: JSON.parse(
        JSON.stringify({
          reason: "Assigned for standard underwriter review",
          routing: "automatic",
          assignedTo: underwriter?.id ?? null,
          assignedToName: underwriter?.name ?? null,
        })
      ),
    },
  });
}
