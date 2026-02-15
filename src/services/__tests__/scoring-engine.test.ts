import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { calculateRiskScore } from "@/services/scoring-engine";
import { TENANT, SUBMISSION, FRAUD_INDICATORS } from "@/test/fixtures";

const mockedPrisma = vi.mocked(prisma);

// ─── Helpers ──────────────────────────────────────────────

/** Build a minimal submission record for findUniqueOrThrow */
function makeSubmission(overrides: Record<string, unknown> = {}) {
  return {
    id: SUBMISSION.clean.id,
    tenantId: TENANT.id,
    ...overrides,
  };
}

/** Build a fraud indicator with defaults */
function makeIndicator(overrides: Record<string, unknown> = {}) {
  return {
    id: "fi-test",
    submissionId: SUBMISSION.clean.id,
    tenantId: TENANT.id,
    documentId: null,
    category: "CROSS_DOC" as const,
    indicatorName: "TEST_INDICATOR",
    description: "test",
    severity: "LOW" as const,
    evidence: {},
    confidence: 0.9,
    recommendedAction: null,
    isOverridden: false,
    overriddenById: null,
    overrideJustification: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────

describe("scoring-engine: calculateRiskScore", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedPrisma.submission.update.mockResolvedValue({} as any);
  });

  // ------------------------------------------------------------------
  // No indicators -> score 0, severity CLEAN
  // ------------------------------------------------------------------

  describe("when there are no indicators", () => {
    it("returns score 0 and severity CLEAN", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([]);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      expect(result.totalScore).toBe(0);
      expect(result.severity).toBe("CLEAN");
      expect(result.indicatorCounts.total).toBe(0);
      expect(result.indicatorCounts.critical).toBe(0);
      expect(result.indicatorCounts.high).toBe(0);
      expect(result.indicatorCounts.medium).toBe(0);
      expect(result.indicatorCounts.low).toBe(0);
    });

    it("updates the submission with riskScore 0 and severity CLEAN", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([]);

      await calculateRiskScore(SUBMISSION.clean.id);

      expect(mockedPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: SUBMISSION.clean.id },
        data: { riskScore: 0, severity: "CLEAN" },
      });
    });

    it("populates all category counts as 0", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([]);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      const expectedCategories = [
        "CROSS_DOC",
        "FORENSIC",
        "STATISTICAL",
        "TEMPORAL",
        "RATIO",
        "ENTITY_INTEL",
        "VISUAL_AI",
        "NLP",
        "API_VERIFY",
        "RULES",
      ];
      for (const cat of expectedCategories) {
        expect(result.categoryCounts[cat]).toBe(0);
        expect(result.categoryPoints[cat]).toBe(0);
      }
    });
  });

  // ------------------------------------------------------------------
  // Only LOW indicators -> low score, severity LOW
  // ------------------------------------------------------------------

  describe("when only LOW indicators are present", () => {
    it("calculates score as count * 1 (LOW weight)", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-1", severity: "LOW", category: "RULES" }),
        makeIndicator({ id: "fi-2", severity: "LOW", category: "STATISTICAL" }),
        makeIndicator({ id: "fi-3", severity: "LOW", category: "RULES" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      // 3 LOW indicators * 1 point each = 3
      expect(result.totalScore).toBe(3);
      expect(result.severity).toBe("LOW");
      expect(result.indicatorCounts.low).toBe(3);
      expect(result.indicatorCounts.total).toBe(3);
    });
  });

  // ------------------------------------------------------------------
  // Mix of severities -> weighted score
  // ------------------------------------------------------------------

  describe("when indicators have mixed severities", () => {
    it("applies correct weights: CRITICAL=25, HIGH=15, MEDIUM=5, LOW=1", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-c", severity: "CRITICAL", category: "FORENSIC" }),
        makeIndicator({ id: "fi-h", severity: "HIGH", category: "CROSS_DOC" }),
        makeIndicator({ id: "fi-m", severity: "MEDIUM", category: "STATISTICAL" }),
        makeIndicator({ id: "fi-l", severity: "LOW", category: "RULES" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      // 25 + 15 + 5 + 1 = 46
      expect(result.totalScore).toBe(46);
      expect(result.indicatorCounts.critical).toBe(1);
      expect(result.indicatorCounts.high).toBe(1);
      expect(result.indicatorCounts.medium).toBe(1);
      expect(result.indicatorCounts.low).toBe(1);
      expect(result.indicatorCounts.total).toBe(4);
    });

    it("calculates correctly with multiple indicators of the same severity", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-h1", severity: "HIGH", category: "CROSS_DOC" }),
        makeIndicator({ id: "fi-h2", severity: "HIGH", category: "TEMPORAL" }),
        makeIndicator({ id: "fi-m1", severity: "MEDIUM", category: "STATISTICAL" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      // 15 + 15 + 5 = 35
      expect(result.totalScore).toBe(35);
      expect(result.indicatorCounts.high).toBe(2);
      expect(result.indicatorCounts.medium).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // Score capped at 100
  // ------------------------------------------------------------------

  describe("score capping", () => {
    it("caps the score at 100 when raw score exceeds 100", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      // 5 CRITICAL indicators: 5 * 25 = 125 -> capped at 100
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-c1", severity: "CRITICAL", category: "FORENSIC" }),
        makeIndicator({ id: "fi-c2", severity: "CRITICAL", category: "CROSS_DOC" }),
        makeIndicator({ id: "fi-c3", severity: "CRITICAL", category: "STATISTICAL" }),
        makeIndicator({ id: "fi-c4", severity: "CRITICAL", category: "TEMPORAL" }),
        makeIndicator({ id: "fi-c5", severity: "CRITICAL", category: "RULES" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      expect(result.totalScore).toBe(100);
    });

    it("does not cap when raw score is exactly 100", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      // 4 CRITICAL = 100 exactly
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-c1", severity: "CRITICAL", category: "FORENSIC" }),
        makeIndicator({ id: "fi-c2", severity: "CRITICAL", category: "CROSS_DOC" }),
        makeIndicator({ id: "fi-c3", severity: "CRITICAL", category: "STATISTICAL" }),
        makeIndicator({ id: "fi-c4", severity: "CRITICAL", category: "TEMPORAL" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      expect(result.totalScore).toBe(100);
    });
  });

  // ------------------------------------------------------------------
  // Any CRITICAL indicator -> severity CRITICAL regardless of score
  // ------------------------------------------------------------------

  describe("CRITICAL severity classification", () => {
    it("returns CRITICAL severity when any CRITICAL indicator exists, even with low total score", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      // 1 CRITICAL = 25 points (below the 85 threshold) -> still CRITICAL
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-c1", severity: "CRITICAL", category: "FORENSIC" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      expect(result.totalScore).toBe(25);
      expect(result.severity).toBe("CRITICAL");
    });

    it("returns CRITICAL when score is below 60 but a CRITICAL indicator exists", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      // 1 CRITICAL + 1 LOW = 26
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-c1", severity: "CRITICAL", category: "FORENSIC" }),
        makeIndicator({ id: "fi-l1", severity: "LOW", category: "RULES" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      expect(result.totalScore).toBe(26);
      expect(result.severity).toBe("CRITICAL");
    });
  });

  // ------------------------------------------------------------------
  // Score-based severity thresholds (no CRITICAL indicators)
  // ------------------------------------------------------------------

  describe("score-based severity thresholds (no CRITICAL indicators)", () => {
    it("score > 85 -> CRITICAL", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      // 6 HIGH = 90 points, > 85
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-h1", severity: "HIGH", category: "CROSS_DOC" }),
        makeIndicator({ id: "fi-h2", severity: "HIGH", category: "TEMPORAL" }),
        makeIndicator({ id: "fi-h3", severity: "HIGH", category: "STATISTICAL" }),
        makeIndicator({ id: "fi-h4", severity: "HIGH", category: "RATIO" }),
        makeIndicator({ id: "fi-h5", severity: "HIGH", category: "ENTITY_INTEL" }),
        makeIndicator({ id: "fi-h6", severity: "HIGH", category: "FORENSIC" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      expect(result.totalScore).toBe(90);
      expect(result.severity).toBe("CRITICAL");
    });

    it("score exactly 85 -> not CRITICAL (condition is >85, not >=85)", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      // 5 HIGH + 2 MEDIUM = 75 + 10 = 85
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-h1", severity: "HIGH", category: "CROSS_DOC" }),
        makeIndicator({ id: "fi-h2", severity: "HIGH", category: "TEMPORAL" }),
        makeIndicator({ id: "fi-h3", severity: "HIGH", category: "STATISTICAL" }),
        makeIndicator({ id: "fi-h4", severity: "HIGH", category: "RATIO" }),
        makeIndicator({ id: "fi-h5", severity: "HIGH", category: "ENTITY_INTEL" }),
        makeIndicator({ id: "fi-m1", severity: "MEDIUM", category: "FORENSIC" }),
        makeIndicator({ id: "fi-m2", severity: "MEDIUM", category: "NLP" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      expect(result.totalScore).toBe(85);
      // 85 is NOT > 85, so it falls through to >= 60
      expect(result.severity).toBe("HIGH");
    });

    it("score >= 60 and <= 85 -> HIGH", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      // 4 HIGH = 60
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-h1", severity: "HIGH", category: "CROSS_DOC" }),
        makeIndicator({ id: "fi-h2", severity: "HIGH", category: "TEMPORAL" }),
        makeIndicator({ id: "fi-h3", severity: "HIGH", category: "STATISTICAL" }),
        makeIndicator({ id: "fi-h4", severity: "HIGH", category: "RATIO" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      expect(result.totalScore).toBe(60);
      expect(result.severity).toBe("HIGH");
    });

    it("score >= 35 and < 60 -> MEDIUM", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      // 2 HIGH + 1 MEDIUM = 30 + 5 = 35
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-h1", severity: "HIGH", category: "CROSS_DOC" }),
        makeIndicator({ id: "fi-h2", severity: "HIGH", category: "TEMPORAL" }),
        makeIndicator({ id: "fi-m1", severity: "MEDIUM", category: "STATISTICAL" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      expect(result.totalScore).toBe(35);
      expect(result.severity).toBe("MEDIUM");
    });

    it("score < 35 -> LOW", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      // 2 HIGH = 30
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-h1", severity: "HIGH", category: "CROSS_DOC" }),
        makeIndicator({ id: "fi-h2", severity: "HIGH", category: "TEMPORAL" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      expect(result.totalScore).toBe(30);
      expect(result.severity).toBe("LOW");
    });
  });

  // ------------------------------------------------------------------
  // Overridden indicators are excluded from scoring
  // ------------------------------------------------------------------

  describe("overridden indicators", () => {
    it("excludes overridden indicators via the prisma query filter", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([]);

      await calculateRiskScore(SUBMISSION.clean.id);

      // Verify the query includes isOverridden: false
      expect(mockedPrisma.fraudIndicator.findMany).toHaveBeenCalledWith({
        where: {
          submissionId: SUBMISSION.clean.id,
          tenantId: TENANT.id,
          isOverridden: false,
        },
      });
    });

    it("correctly scores when overridden indicators are filtered out by prisma", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      // Simulate prisma returning only non-overridden indicators
      // (the CRITICAL one was overridden and is not returned)
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-l1", severity: "LOW", category: "RULES" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      expect(result.totalScore).toBe(1);
      expect(result.severity).toBe("LOW");
    });
  });

  // ------------------------------------------------------------------
  // Category breakdown populated correctly
  // ------------------------------------------------------------------

  describe("category breakdown", () => {
    it("tracks counts and points per category", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-1", severity: "CRITICAL", category: "CROSS_DOC" }),
        makeIndicator({ id: "fi-2", severity: "HIGH", category: "CROSS_DOC" }),
        makeIndicator({ id: "fi-3", severity: "MEDIUM", category: "STATISTICAL" }),
        makeIndicator({ id: "fi-4", severity: "LOW", category: "FORENSIC" }),
        makeIndicator({ id: "fi-5", severity: "LOW", category: "FORENSIC" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      // CROSS_DOC: 1 CRITICAL (25) + 1 HIGH (15) = 40 points, 2 count
      expect(result.categoryCounts["CROSS_DOC"]).toBe(2);
      expect(result.categoryPoints["CROSS_DOC"]).toBe(40);

      // STATISTICAL: 1 MEDIUM (5) = 5 points, 1 count
      expect(result.categoryCounts["STATISTICAL"]).toBe(1);
      expect(result.categoryPoints["STATISTICAL"]).toBe(5);

      // FORENSIC: 2 LOW (1 each) = 2 points, 2 count
      expect(result.categoryCounts["FORENSIC"]).toBe(2);
      expect(result.categoryPoints["FORENSIC"]).toBe(2);

      // Unused categories should be 0
      expect(result.categoryCounts["TEMPORAL"]).toBe(0);
      expect(result.categoryPoints["TEMPORAL"]).toBe(0);
      expect(result.categoryCounts["RULES"]).toBe(0);
      expect(result.categoryPoints["RULES"]).toBe(0);
    });

    it("includes all 10 categories in the breakdown even when empty", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-1", severity: "LOW", category: "RULES" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      const allCategories = [
        "CROSS_DOC",
        "FORENSIC",
        "STATISTICAL",
        "TEMPORAL",
        "RATIO",
        "ENTITY_INTEL",
        "VISUAL_AI",
        "NLP",
        "API_VERIFY",
        "RULES",
      ];
      for (const cat of allCategories) {
        expect(result.categoryCounts).toHaveProperty(cat);
        expect(result.categoryPoints).toHaveProperty(cat);
      }
    });
  });

  // ------------------------------------------------------------------
  // Submission record is updated
  // ------------------------------------------------------------------

  describe("submission update", () => {
    it("updates the submission with the calculated riskScore and severity", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-h1", severity: "HIGH", category: "CROSS_DOC" }),
        makeIndicator({ id: "fi-h2", severity: "HIGH", category: "TEMPORAL" }),
        makeIndicator({ id: "fi-h3", severity: "HIGH", category: "STATISTICAL" }),
        makeIndicator({ id: "fi-h4", severity: "HIGH", category: "RATIO" }),
      ] as any);

      const result = await calculateRiskScore(SUBMISSION.clean.id);

      expect(mockedPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: SUBMISSION.clean.id },
        data: {
          riskScore: 60,
          severity: "HIGH",
        },
      });
      expect(result.totalScore).toBe(60);
      expect(result.severity).toBe("HIGH");
    });

    it("updates with capped score when raw score exceeds 100", async () => {
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission() as any
      );
      // Raw score = 125, capped at 100
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([
        makeIndicator({ id: "fi-c1", severity: "CRITICAL", category: "FORENSIC" }),
        makeIndicator({ id: "fi-c2", severity: "CRITICAL", category: "CROSS_DOC" }),
        makeIndicator({ id: "fi-c3", severity: "CRITICAL", category: "STATISTICAL" }),
        makeIndicator({ id: "fi-c4", severity: "CRITICAL", category: "TEMPORAL" }),
        makeIndicator({ id: "fi-c5", severity: "CRITICAL", category: "RULES" }),
      ] as any);

      await calculateRiskScore(SUBMISSION.clean.id);

      expect(mockedPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: SUBMISSION.clean.id },
        data: {
          riskScore: 100,
          severity: "CRITICAL",
        },
      });
    });
  });

  // ------------------------------------------------------------------
  // Uses submission's tenantId for the query
  // ------------------------------------------------------------------

  describe("tenant scoping", () => {
    it("queries indicators using the tenantId from the submission", async () => {
      const customTenantId = "tenant-custom";
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmission({ tenantId: customTenantId }) as any
      );
      mockedPrisma.fraudIndicator.findMany.mockResolvedValue([]);

      await calculateRiskScore(SUBMISSION.clean.id);

      expect(mockedPrisma.fraudIndicator.findMany).toHaveBeenCalledWith({
        where: {
          submissionId: SUBMISSION.clean.id,
          tenantId: customTenantId,
          isOverridden: false,
        },
      });
    });
  });
});
