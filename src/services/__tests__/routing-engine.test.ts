import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { routeSubmission } from "@/services/routing-engine";
import {
  TENANT,
  SUBMISSION,
  USERS,
  THRESHOLD_CONFIG,
} from "@/test/fixtures";

const mockedPrisma = vi.mocked(prisma);

// ─── Helpers ──────────────────────────────────────────────

function makeSubmission(overrides: Record<string, unknown> = {}) {
  return {
    id: SUBMISSION.clean.id,
    tenantId: TENANT.id,
    lineOfBusiness: "General Liability",
    riskScore: 0,
    severity: null,
    status: "PROCESSING",
    assignedUnderwriterId: null,
    ...overrides,
  };
}

function makeThresholdConfig(overrides: Record<string, unknown> = {}) {
  return {
    ...THRESHOLD_CONFIG.default,
    ...overrides,
  };
}

function makeIndicator(overrides: Record<string, unknown> = {}) {
  return {
    id: "fi-test",
    submissionId: SUBMISSION.clean.id,
    tenantId: TENANT.id,
    category: "STATISTICAL" as const,
    indicatorName: "TEST",
    description: "test indicator",
    severity: "LOW" as const,
    evidence: {},
    confidence: 0.9,
    isOverridden: false,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────

describe("routing-engine: routeSubmission", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default: return the basic submission
    mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
      makeSubmission() as any
    );
    mockedPrisma.submission.update.mockResolvedValue({} as any);
    mockedPrisma.auditLog.create.mockResolvedValue({} as any);
    mockedPrisma.sIUCase.create.mockResolvedValue({} as any);

    // Default: no indicators
    mockedPrisma.fraudIndicator.findMany.mockResolvedValue([]);

    // Default: no users found
    mockedPrisma.user.findFirst.mockResolvedValue(null);
  });

  // ------------------------------------------------------------------
  // Auto-approve: score below autoApproveBelow and no MEDIUM+ indicators
  // ------------------------------------------------------------------

  describe("auto-approve path", () => {
    it("auto-approves when score is below autoApproveBelow and no MEDIUM+ indicators", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 10 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ autoApproveBelow: 20, autoEscalateAbove: 70 }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ severity: "LOW" }),
      ] as any);

      await routeSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: SUBMISSION.clean.id },
        data: { status: "APPROVED" },
      });
    });

    it("creates an audit log entry for auto-approval", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 5 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig() as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([]);

      await routeSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT.id,
          submissionId: SUBMISSION.clean.id,
          action: "SUBMISSION_APPROVED",
        }),
      });
    });

    it("does NOT auto-approve if MEDIUM indicator exists even when score is low", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 10 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ autoApproveBelow: 20, autoEscalateAbove: 70 }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ severity: "MEDIUM" }),
      ] as any);

      await routeSubmission(SUBMISSION.clean.id);

      // Should go to underwriter review, not auto-approve
      expect(mockedPrisma.submission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "UNDER_REVIEW" }),
        })
      );
    });

    it("does NOT auto-approve when score equals autoApproveBelow (must be strictly less)", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 20 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ autoApproveBelow: 20 }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([]);

      await routeSubmission(SUBMISSION.clean.id);

      // score=20 is not < 20, so it should NOT be auto-approved
      expect(mockedPrisma.submission.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "APPROVED" },
        })
      );
    });
  });

  // ------------------------------------------------------------------
  // Escalation: score above autoEscalateAbove or CRITICAL indicator
  // ------------------------------------------------------------------

  describe("escalation path", () => {
    it("escalates when score is above autoEscalateAbove", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 75 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ autoApproveBelow: 20, autoEscalateAbove: 70 }) as any
      );
      // No forged doc indicator, so SIU is not triggered
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ severity: "HIGH", category: "CROSS_DOC" }),
      ] as any);

      await routeSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.submission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "UNDER_REVIEW" }),
        })
      );
    });

    it("assigns a senior underwriter on escalation", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 80 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ autoEscalateAbove: 70 }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ severity: "HIGH" }),
      ] as any);
      mockedPrisma.user.findFirst.mockResolvedValue(USERS.seniorUnderwriter as any);

      await routeSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: SUBMISSION.clean.id },
        data: {
          status: "UNDER_REVIEW",
          assignedUnderwriterId: USERS.seniorUnderwriter.id,
        },
      });
    });

    it("escalates when a CRITICAL indicator is present even if score is below escalation threshold", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 50 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({
          autoApproveBelow: 20,
          autoEscalateAbove: 70,
          siuReferralOnCritical: false,
        }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ severity: "CRITICAL", category: "CROSS_DOC" }),
      ] as any);

      await routeSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.submission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "UNDER_REVIEW" }),
        })
      );
    });

    it("creates an SUBMISSION_ESCALATED audit log on escalation", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 80 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ autoEscalateAbove: 70 }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([]);

      await routeSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT.id,
          submissionId: SUBMISSION.clean.id,
          action: "SUBMISSION_ESCALATED",
        }),
      });
    });
  });

  // ------------------------------------------------------------------
  // Default: UNDER_REVIEW with standard underwriter assignment
  // ------------------------------------------------------------------

  describe("standard underwriter review path", () => {
    it("assigns to underwriter review when score is between thresholds", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 45 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ autoApproveBelow: 20, autoEscalateAbove: 70 }) as any
      );
      // Has MEDIUM indicator, so cannot be auto-approved
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ severity: "MEDIUM" }),
      ] as any);
      mockedPrisma.user.findFirst.mockResolvedValue(USERS.underwriter as any);

      await routeSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: SUBMISSION.clean.id },
        data: {
          status: "UNDER_REVIEW",
          assignedUnderwriterId: USERS.underwriter.id,
        },
      });
    });

    it("handles no available underwriter gracefully (null assignment)", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 45 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig() as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ severity: "MEDIUM" }),
      ] as any);
      mockedPrisma.user.findFirst.mockResolvedValue(null);

      await routeSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: SUBMISSION.clean.id },
        data: {
          status: "UNDER_REVIEW",
          assignedUnderwriterId: null,
        },
      });
    });
  });

  // ------------------------------------------------------------------
  // SIU Referral: CRITICAL + siuReferralOnCritical + FORENSIC CRITICAL
  // ------------------------------------------------------------------

  describe("SIU referral path", () => {
    it("refers to SIU when siuReferralOnCritical is true and FORENSIC CRITICAL indicator exists", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 90 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ siuReferralOnCritical: true }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ severity: "CRITICAL", category: "FORENSIC" }),
      ] as any);
      mockedPrisma.user.findFirst.mockResolvedValue(USERS.siuInvestigator as any);

      await routeSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: SUBMISSION.clean.id },
        data: { status: "REFERRED_TO_SIU" },
      });
    });

    it("creates an SIU case when an SIU investigator is available", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 90 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ siuReferralOnCritical: true }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ severity: "CRITICAL", category: "FORENSIC" }),
      ] as any);
      mockedPrisma.user.findFirst.mockResolvedValue(USERS.siuInvestigator as any);

      await routeSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.sIUCase.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT.id,
          submissionId: SUBMISSION.clean.id,
          status: "OPEN",
          assignedToId: USERS.siuInvestigator.id,
        },
      });
    });

    it("does NOT create SIU case when no SIU investigator is available", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 90 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ siuReferralOnCritical: true }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ severity: "CRITICAL", category: "FORENSIC" }),
      ] as any);
      mockedPrisma.user.findFirst.mockResolvedValue(null);

      await routeSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.sIUCase.create).not.toHaveBeenCalled();
      // Still marks the submission as referred
      expect(mockedPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: SUBMISSION.clean.id },
        data: { status: "REFERRED_TO_SIU" },
      });
    });

    it("creates an SIU_REFERRAL audit log", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 90 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ siuReferralOnCritical: true }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ severity: "CRITICAL", category: "FORENSIC" }),
      ] as any);
      mockedPrisma.user.findFirst.mockResolvedValue(USERS.siuInvestigator as any);

      await routeSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT.id,
          submissionId: SUBMISSION.clean.id,
          action: "SIU_REFERRAL",
        }),
      });
    });

    it("does NOT refer to SIU when siuReferralOnCritical is false even with FORENSIC CRITICAL", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 90 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ siuReferralOnCritical: false, autoEscalateAbove: 70 }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ severity: "CRITICAL", category: "FORENSIC" }),
      ] as any);

      await routeSubmission(SUBMISSION.clean.id);

      // Should escalate instead, not refer to SIU
      expect(mockedPrisma.submission.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "REFERRED_TO_SIU" },
        })
      );
    });

    it("does NOT refer to SIU for non-FORENSIC CRITICAL indicators", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 90 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ siuReferralOnCritical: true, autoEscalateAbove: 70 }) as any
      );
      // CRITICAL but not FORENSIC category
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ severity: "CRITICAL", category: "CROSS_DOC" }),
      ] as any);

      await routeSubmission(SUBMISSION.clean.id);

      // Should escalate, not SIU referral
      expect(mockedPrisma.submission.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "REFERRED_TO_SIU" },
        })
      );
    });

    it("SIU referral takes priority over escalation", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 95 }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ siuReferralOnCritical: true, autoEscalateAbove: 70 }) as any
      );
      // Both FORENSIC CRITICAL (SIU trigger) and score > 70 (escalate trigger)
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ severity: "CRITICAL", category: "FORENSIC" }),
        makeIndicator({ severity: "HIGH", category: "CROSS_DOC" }),
      ] as any);
      mockedPrisma.user.findFirst.mockResolvedValue(USERS.siuInvestigator as any);

      await routeSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: SUBMISSION.clean.id },
        data: { status: "REFERRED_TO_SIU" },
      });
    });
  });

  // ------------------------------------------------------------------
  // LOB-specific threshold config vs global fallback
  // ------------------------------------------------------------------

  describe("threshold config resolution", () => {
    it("uses LOB-specific threshold config when available", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 15, lineOfBusiness: "Workers Compensation" }) as any
      );
      // First call: LOB-specific config found
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValueOnce(
        makeThresholdConfig({
          lineOfBusiness: "Workers Compensation",
          autoApproveBelow: 10, // Lower threshold for WC
          autoEscalateAbove: 60,
        }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([]);

      await routeSubmission(SUBMISSION.clean.id);

      // Score 15 >= autoApproveBelow 10, so it should NOT be auto-approved
      // It should go to underwriter review instead
      expect(mockedPrisma.submission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "UNDER_REVIEW" }),
        })
      );
    });

    it("falls back to global config when LOB-specific is not found", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 10, lineOfBusiness: "General Liability" }) as any
      );
      // First call: LOB-specific not found
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValueOnce(null);
      // Second call: global config
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValueOnce(
        makeThresholdConfig({ lineOfBusiness: null, autoApproveBelow: 20 }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([]);

      await routeSubmission(SUBMISSION.clean.id);

      // Score 10 < autoApproveBelow 20, should be auto-approved
      expect(mockedPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: SUBMISSION.clean.id },
        data: { status: "APPROVED" },
      });
    });

    it("uses hardcoded defaults when no config exists at all", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 10, lineOfBusiness: null }) as any
      );
      // No LOB-specific, no global
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(null);
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([]);

      await routeSubmission(SUBMISSION.clean.id);

      // Default autoApproveBelow = 20, score 10 < 20 -> approved
      expect(mockedPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: SUBMISSION.clean.id },
        data: { status: "APPROVED" },
      });
    });

    it("skips LOB lookup when lineOfBusiness is null", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: 10, lineOfBusiness: null }) as any
      );
      // Only one call: the global config lookup
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValueOnce(
        makeThresholdConfig({ lineOfBusiness: null, autoApproveBelow: 20 }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([]);

      await routeSubmission(SUBMISSION.clean.id);

      // Only one findFirst call (global), not two
      expect(mockedPrisma.thresholdConfig.findFirst).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.thresholdConfig.findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT.id, lineOfBusiness: null },
      });
    });
  });

  // ------------------------------------------------------------------
  // Null riskScore defaults to 0
  // ------------------------------------------------------------------

  describe("null riskScore handling", () => {
    it("treats null riskScore as 0", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ riskScore: null }) as any
      );
      mockedPrisma.thresholdConfig.findFirst.mockResolvedValue(
        makeThresholdConfig({ autoApproveBelow: 20 }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([]);

      await routeSubmission(SUBMISSION.clean.id);

      // 0 < 20 -> auto-approve
      expect(mockedPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: SUBMISSION.clean.id },
        data: { status: "APPROVED" },
      });
    });
  });
});
