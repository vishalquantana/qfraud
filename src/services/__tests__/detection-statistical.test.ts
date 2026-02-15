import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { detectStatisticalAnomalies } from "@/services/detection-statistical";

// ─── Typed mocks ──────────────────────────────────────────

const mockPrisma = vi.mocked(prisma, true);

// ─── Helpers ──────────────────────────────────────────────

const SUBMISSION_ID = "sub-test";
const TENANT_ID = "tenant-001";

function setupSubmission() {
  mockPrisma.submission.findUniqueOrThrow.mockResolvedValue({
    id: SUBMISSION_ID,
    tenantId: TENANT_ID,
  } as never);
}

/**
 * Build a mock document row that `findFirst` returns for a given documentType.
 */
function makeDoc(
  documentType: string,
  extractedData: Record<string, unknown> | null,
  id = `doc-${documentType.toLowerCase()}`,
) {
  return {
    id,
    submissionId: SUBMISSION_ID,
    tenantId: TENANT_ID,
    documentType,
    status: "ANALYZED",
    extractedData,
    createdAt: new Date("2025-06-01"),
  };
}

/**
 * Configure `prisma.document.findFirst` to return different documents
 * depending on the `documentType` query filter.
 */
function mockDocuments(
  map: Record<string, ReturnType<typeof makeDoc> | null>,
) {
  mockPrisma.document.findFirst.mockImplementation(((args: {
    where?: { documentType?: string };
  }) => {
    const docType = args?.where?.documentType as string | undefined;
    if (docType && docType in map) {
      return Promise.resolve(map[docType]);
    }
    return Promise.resolve(null);
  }) as never);
}

// ─── Tests ────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.fraudIndicator.create.mockResolvedValue({} as never);
});

describe("detectStatisticalAnomalies", () => {
  // ── Skips when no extracted data ─────────────────────

  describe("when no documents exist", () => {
    it("skips without creating any fraud indicators", async () => {
      setupSubmission();
      mockDocuments({});
      // findFirst returns null for everything by default
      mockPrisma.document.findFirst.mockResolvedValue(null);

      await detectStatisticalAnomalies(SUBMISSION_ID);

      expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
    });
  });

  // ── Round number detection ───────────────────────────

  describe("round number detection", () => {
    it("flags currency values that are exact multiples of $100K", async () => {
      setupSubmission();
      mockDocuments({
        ACORD_125: makeDoc("ACORD_125", {
          annualRevenue: 500000, // exact $500K
          priorPremium: 200000, // exact $200K
          naicsCode: "332710",
        }),
        ACORD_130: makeDoc("ACORD_130", {
          totalPayroll: 300000, // exact $300K
        }),
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 500000,
          costOfGoodsSold: 250000, // not round (but wait, it is... it's not a multiple of 100K if 250000/100000 = 2.5, but 250000 % 100000 = 50000 !== 0)
          netIncome: 100000,
          totalAssets: 400000,
          totalLiabilities: 200000,
        }),
      });

      await detectStatisticalAnomalies(SUBMISSION_ID);

      // Should create a ROUND_NUMBER_ANOMALY indicator
      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const roundNumberCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "ROUND_NUMBER_ANOMALY",
      );

      expect(roundNumberCall).toBeDefined();
      const data = (roundNumberCall![0] as { data: Record<string, unknown> })
        .data;
      expect(data.category).toBe("STATISTICAL");
      expect(data.severity).toBe("MEDIUM");
      expect(data.submissionId).toBe(SUBMISSION_ID);
    });

    it("does not flag when no values are round multiples of $100K", async () => {
      setupSubmission();
      mockDocuments({
        ACORD_125: makeDoc("ACORD_125", {
          annualRevenue: 523456,
          priorPremium: 15789,
          naicsCode: "332710",
        }),
        ACORD_130: makeDoc("ACORD_130", {
          totalPayroll: 287654,
        }),
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 523456,
          costOfGoodsSold: 312345,
          netIncome: 45678,
          totalAssets: 456789,
          totalLiabilities: 234567,
        }),
      });

      await detectStatisticalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const roundNumberCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "ROUND_NUMBER_ANOMALY",
      );
      expect(roundNumberCall).toBeUndefined();
    });
  });

  // ── Revenue growth anomaly ───────────────────────────

  describe("revenue growth anomaly", () => {
    it("flags YoY revenue growth exceeding the threshold for the NAICS sector", async () => {
      setupSubmission();
      // NAICS 33 => Manufacturing, maxRevenueGrowthPercent = 30
      // Current revenue (from ACORD 125) = $10M, prior (financial statement) = $6M
      // Growth = (10M - 6M) / 6M = 66.7%, well above 30%
      mockDocuments({
        ACORD_125: makeDoc("ACORD_125", {
          annualRevenue: 10000000,
          naicsCode: "332710",
        }),
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 6000000,
          costOfGoodsSold: null,
          netIncome: null,
          totalAssets: null,
          totalLiabilities: null,
        }),
      });

      await detectStatisticalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const revenueCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "REVENUE_GROWTH_ANOMALY",
      );

      expect(revenueCall).toBeDefined();
      const data = (revenueCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("HIGH");
      expect(data.category).toBe("STATISTICAL");
    });

    it("does not flag revenue growth within the threshold", async () => {
      setupSubmission();
      // Growth = (5.5M - 5M) / 5M = 10%, below 30%
      mockDocuments({
        ACORD_125: makeDoc("ACORD_125", {
          annualRevenue: 5500000,
          naicsCode: "332710",
        }),
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 5000000,
          costOfGoodsSold: null,
          netIncome: null,
          totalAssets: null,
          totalLiabilities: null,
        }),
      });

      await detectStatisticalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const revenueCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "REVENUE_GROWTH_ANOMALY",
      );
      expect(revenueCall).toBeUndefined();
    });

    it("skips when prior revenue is zero or negative", async () => {
      setupSubmission();
      mockDocuments({
        ACORD_125: makeDoc("ACORD_125", {
          annualRevenue: 5000000,
          naicsCode: "332710",
        }),
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 0,
          costOfGoodsSold: null,
          netIncome: null,
          totalAssets: null,
          totalLiabilities: null,
        }),
      });

      await detectStatisticalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const revenueCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "REVENUE_GROWTH_ANOMALY",
      );
      expect(revenueCall).toBeUndefined();
    });
  });

  // ── COGS margin anomaly ──────────────────────────────

  describe("COGS margin anomaly", () => {
    it("flags COGS percentage deviating >15 points from industry range", async () => {
      setupSubmission();
      // NAICS 33 => cogsMarginRange [45, 75]
      // revenue = $1M, COGS = $50K => 5%, expected min is 45%
      // deviation = 45 - 5 = 40 points, way above 15
      mockDocuments({
        ACORD_125: makeDoc("ACORD_125", {
          naicsCode: "332710",
          annualRevenue: null,
        }),
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 1000000,
          costOfGoodsSold: 50000,
          netIncome: null,
          totalAssets: null,
          totalLiabilities: null,
        }),
      });

      await detectStatisticalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const cogsCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "COGS_MARGIN_ANOMALY",
      );

      expect(cogsCall).toBeDefined();
      const data = (cogsCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("HIGH");
    });

    it("does not flag COGS percentage within the expected range", async () => {
      setupSubmission();
      // NAICS 33 => cogsMarginRange [45, 75]
      // revenue = $1M, COGS = $600K => 60%, within [45, 75]
      mockDocuments({
        ACORD_125: makeDoc("ACORD_125", {
          naicsCode: "332710",
          annualRevenue: null,
        }),
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 1000000,
          costOfGoodsSold: 600000,
          netIncome: null,
          totalAssets: null,
          totalLiabilities: null,
        }),
      });

      await detectStatisticalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const cogsCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "COGS_MARGIN_ANOMALY",
      );
      expect(cogsCall).toBeUndefined();
    });

    it("skips when revenue or COGS is null", async () => {
      setupSubmission();
      mockDocuments({
        ACORD_125: makeDoc("ACORD_125", {
          naicsCode: "332710",
          annualRevenue: null,
        }),
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: null,
          costOfGoodsSold: null,
          netIncome: null,
          totalAssets: null,
          totalLiabilities: null,
        }),
      });

      await detectStatisticalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const cogsCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "COGS_MARGIN_ANOMALY",
      );
      expect(cogsCall).toBeUndefined();
    });
  });

  // ── Payroll-per-head anomaly ─────────────────────────

  describe("payroll-per-head anomaly", () => {
    it("flags per-employee payroll below industry minimum", async () => {
      setupSubmission();
      // NAICS 33 => payrollPerHeadRange [40000, 85000]
      // totalPayroll = $500K, employees = 50 => $10K/head, below 40K min
      mockDocuments({
        ACORD_130: makeDoc("ACORD_130", {
          totalPayroll: 500000,
          payrollByClassification: [],
        }),
        ACORD_125: makeDoc("ACORD_125", {
          numberOfEmployees: 50,
          naicsCode: "332710",
          annualRevenue: null,
        }),
      });

      await detectStatisticalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const payrollCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "PAYROLL_PER_HEAD_ANOMALY",
      );

      expect(payrollCall).toBeDefined();
      const data = (payrollCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("HIGH");
    });

    it("flags per-employee payroll above industry maximum", async () => {
      setupSubmission();
      // NAICS 33 => payrollPerHeadRange [40000, 85000]
      // totalPayroll = $5M, employees = 10 => $500K/head, above 85K max
      mockDocuments({
        ACORD_130: makeDoc("ACORD_130", {
          totalPayroll: 5000000,
          payrollByClassification: [],
        }),
        ACORD_125: makeDoc("ACORD_125", {
          numberOfEmployees: 10,
          naicsCode: "332710",
          annualRevenue: null,
        }),
      });

      await detectStatisticalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const payrollCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "PAYROLL_PER_HEAD_ANOMALY",
      );

      expect(payrollCall).toBeDefined();
    });

    it("does not flag payroll-per-head within the expected range", async () => {
      setupSubmission();
      // NAICS 33 => payrollPerHeadRange [40000, 85000]
      // totalPayroll = $3M, employees = 50 => $60K/head, within range
      mockDocuments({
        ACORD_130: makeDoc("ACORD_130", {
          totalPayroll: 3000000,
          payrollByClassification: [],
        }),
        ACORD_125: makeDoc("ACORD_125", {
          numberOfEmployees: 50,
          naicsCode: "332710",
          annualRevenue: null,
        }),
      });

      await detectStatisticalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const payrollCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "PAYROLL_PER_HEAD_ANOMALY",
      );
      expect(payrollCall).toBeUndefined();
    });

    it("falls back to ACORD 130 payrollByClassification employee count when ACORD 125 has none", async () => {
      setupSubmission();
      // No ACORD_125, so employee count comes from payrollByClassification
      // totalPayroll = $200K, employees = 50 => $4K/head, below 25K min (default)
      mockDocuments({
        ACORD_130: makeDoc("ACORD_130", {
          totalPayroll: 200000,
          payrollByClassification: [
            { classCode: "3632", description: "Machine Shop", payroll: 100000, employeeCount: 25 },
            { classCode: "8810", description: "Clerical", payroll: 100000, employeeCount: 25 },
          ],
        }),
        ACORD_125: null,
      });

      await detectStatisticalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const payrollCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "PAYROLL_PER_HEAD_ANOMALY",
      );

      expect(payrollCall).toBeDefined();
    });

    it("skips when no employee count is available", async () => {
      setupSubmission();
      mockDocuments({
        ACORD_130: makeDoc("ACORD_130", {
          totalPayroll: 500000,
          payrollByClassification: [],
        }),
        ACORD_125: makeDoc("ACORD_125", {
          numberOfEmployees: null,
          naicsCode: "332710",
          annualRevenue: null,
        }),
      });

      await detectStatisticalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const payrollCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "PAYROLL_PER_HEAD_ANOMALY",
      );
      expect(payrollCall).toBeUndefined();
    });
  });
});
