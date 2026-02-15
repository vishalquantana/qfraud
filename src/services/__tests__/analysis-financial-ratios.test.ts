import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { analyzeFinancialRatios } from "@/services/analysis-financial-ratios";

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

describe("analyzeFinancialRatios", () => {
  // ── Skips when financial data missing ────────────────

  describe("when financial data is missing", () => {
    it("skips all checks when no documents exist", async () => {
      setupSubmission();
      mockPrisma.document.findFirst.mockResolvedValue(null);

      await analyzeFinancialRatios(SUBMISSION_ID);

      expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
    });

    it("skips DSO check when accounts receivable is null", async () => {
      setupSubmission();
      mockDocuments({
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 5000000,
          accountsReceivable: null,
          netIncome: null,
        }),
        ACORD_125: makeDoc("ACORD_125", {
          annualRevenue: 6000000,
          naicsCode: "332710",
        }),
      });

      await analyzeFinancialRatios(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const dsoCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "DSO_REVENUE_ANOMALY",
      );
      expect(dsoCall).toBeUndefined();
    });
  });

  // ── DSO calculation ──────────────────────────────────

  describe("DSO anomaly detection", () => {
    it("flags high DSO (>20% above 45-day norm) with growing revenue", async () => {
      setupSubmission();
      // DSO = (AR / revenue) * 365 = (500000 / 2000000) * 365 = 91.25 days
      // dsoGrowthPercent = (91.25 - 45) / 45 * 100 = 102.8% > 20%
      // Revenue growth = (3000000 - 2000000) / 2000000 * 100 = 50% > 0
      mockDocuments({
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 2000000,
          accountsReceivable: 500000,
          netIncome: null,
        }),
        ACORD_125: makeDoc("ACORD_125", {
          annualRevenue: 3000000,
          naicsCode: "332710",
        }),
      });

      await analyzeFinancialRatios(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const dsoCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "DSO_REVENUE_ANOMALY",
      );

      expect(dsoCall).toBeDefined();
      const data = (dsoCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("CRITICAL");
      expect(data.category).toBe("RATIO");
    });

    it("does not flag when DSO is within normal range", async () => {
      setupSubmission();
      // DSO = (100000 / 5000000) * 365 = 7.3 days (well below 45-day norm)
      // dsoGrowthPercent = (7.3 - 45) / 45 * 100 = -83.8% <= 20%
      mockDocuments({
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 5000000,
          accountsReceivable: 100000,
          netIncome: null,
        }),
        ACORD_125: makeDoc("ACORD_125", {
          annualRevenue: 6000000,
          naicsCode: "332710",
        }),
      });

      await analyzeFinancialRatios(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const dsoCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "DSO_REVENUE_ANOMALY",
      );
      expect(dsoCall).toBeUndefined();
    });

    it("does not flag when revenue is declining", async () => {
      setupSubmission();
      // Revenue declining: current < prior
      mockDocuments({
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 5000000,
          accountsReceivable: 2000000, // high AR
          netIncome: null,
        }),
        ACORD_125: makeDoc("ACORD_125", {
          annualRevenue: 4000000, // lower than prior
          naicsCode: "332710",
        }),
      });

      await analyzeFinancialRatios(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const dsoCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "DSO_REVENUE_ANOMALY",
      );
      expect(dsoCall).toBeUndefined();
    });
  });

  // ── A/R ratio ────────────────────────────────────────

  describe("A/R ratio anomaly detection", () => {
    it("flags accounts receivable >40% of revenue", async () => {
      setupSubmission();
      // AR / revenue = 2500000 / 5000000 = 50% > 40%
      mockDocuments({
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 5000000,
          accountsReceivable: 2500000,
          netIncome: null,
        }),
        ACORD_125: null,
      });

      await analyzeFinancialRatios(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const arCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "AR_RATIO_ANOMALY",
      );

      expect(arCall).toBeDefined();
      const data = (arCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("HIGH");
      expect(data.category).toBe("RATIO");
    });

    it("does not flag A/R at or below 40%", async () => {
      setupSubmission();
      // AR / revenue = 2000000 / 5000000 = 40% (at threshold, not above)
      mockDocuments({
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 5000000,
          accountsReceivable: 2000000,
          netIncome: null,
        }),
        ACORD_125: null,
      });

      await analyzeFinancialRatios(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const arCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "AR_RATIO_ANOMALY",
      );
      expect(arCall).toBeUndefined();
    });
  });

  // ── Profit margin ────────────────────────────────────

  describe("profit margin anomaly detection", () => {
    it("flags net profit margin exceeding industry average by >50%", async () => {
      setupSubmission();
      // NAICS 33 => industry avg = 8%
      // threshold = 8 * 1.5 = 12%
      // netIncome / revenue = 1500000 / 5000000 = 30% > 12%
      mockDocuments({
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 5000000,
          netIncome: 1500000,
          accountsReceivable: null,
        }),
        ACORD_125: makeDoc("ACORD_125", {
          annualRevenue: null,
          naicsCode: "332710",
        }),
      });

      await analyzeFinancialRatios(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const marginCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "PROFIT_MARGIN_ANOMALY",
      );

      expect(marginCall).toBeDefined();
      const data = (marginCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("MEDIUM");
      expect(data.category).toBe("RATIO");
    });

    it("does not flag profit margin at or below 1.5x industry average", async () => {
      setupSubmission();
      // NAICS 33 => industry avg = 8%, threshold = 12%
      // netIncome / revenue = 500000 / 5000000 = 10% <= 12%
      mockDocuments({
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 5000000,
          netIncome: 500000,
          accountsReceivable: null,
        }),
        ACORD_125: makeDoc("ACORD_125", {
          annualRevenue: null,
          naicsCode: "332710",
        }),
      });

      await analyzeFinancialRatios(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const marginCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "PROFIT_MARGIN_ANOMALY",
      );
      expect(marginCall).toBeUndefined();
    });

    it("uses default industry average when NAICS code is not available", async () => {
      setupSubmission();
      // No ACORD 125 => default profit margin = 8%, threshold = 12%
      // netIncome / revenue = 1500000 / 5000000 = 30% > 12%
      mockDocuments({
        FINANCIAL_STATEMENT: makeDoc("FINANCIAL_STATEMENT", {
          revenue: 5000000,
          netIncome: 1500000,
          accountsReceivable: null,
        }),
        ACORD_125: null,
      });

      await analyzeFinancialRatios(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const marginCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "PROFIT_MARGIN_ANOMALY",
      );
      expect(marginCall).toBeDefined();
    });
  });

  // ── Contents-to-building ratio ───────────────────────

  describe("contents-to-building ratio", () => {
    it("flags ratio outside expected range for classification", async () => {
      setupSubmission();
      // Retail occupancy => expected range [20, 40]
      // contentsValue / buildingValue = 500000 / 500000 = 100% >> 40%
      mockDocuments({
        ACORD_140: makeDoc("ACORD_140", {
          propertyLocations: [
            {
              address: "123 Main St",
              buildingValue: 500000,
              contentsValue: 500000,
              occupancy: "Retail Store",
            },
          ],
        }),
        ACORD_125: null,
      });

      await analyzeFinancialRatios(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const ratioCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "CONTENTS_TO_BUILDING_RATIO_ANOMALY",
      );

      expect(ratioCall).toBeDefined();
      const data = (ratioCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("HIGH");
      expect(data.category).toBe("RATIO");
    });

    it("does not flag ratio within expected range", async () => {
      setupSubmission();
      // Office occupancy => expected range [10, 30]
      // contentsValue / buildingValue = 100000 / 500000 = 20% (within [10, 30])
      mockDocuments({
        ACORD_140: makeDoc("ACORD_140", {
          propertyLocations: [
            {
              address: "456 Business Ave",
              buildingValue: 500000,
              contentsValue: 100000,
              occupancy: "Professional Office",
            },
          ],
        }),
        ACORD_125: null,
      });

      await analyzeFinancialRatios(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const ratioCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "CONTENTS_TO_BUILDING_RATIO_ANOMALY",
      );
      expect(ratioCall).toBeUndefined();
    });

    it("flags unusually low contents ratio (potential underinsurance)", async () => {
      setupSubmission();
      // Manufacturing occupancy => expected range [30, 60]
      // contentsValue / buildingValue = 10000 / 1000000 = 1% << 30%
      mockDocuments({
        ACORD_140: makeDoc("ACORD_140", {
          propertyLocations: [
            {
              address: "789 Industrial Blvd",
              buildingValue: 1000000,
              contentsValue: 10000,
              occupancy: "Manufacturing Plant",
            },
          ],
        }),
        ACORD_125: null,
      });

      await analyzeFinancialRatios(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const ratioCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "CONTENTS_TO_BUILDING_RATIO_ANOMALY",
      );
      expect(ratioCall).toBeDefined();
    });

    it("skips when building or contents value is null or zero", async () => {
      setupSubmission();
      mockDocuments({
        ACORD_140: makeDoc("ACORD_140", {
          propertyLocations: [
            {
              address: "123 Main St",
              buildingValue: 0,
              contentsValue: 100000,
              occupancy: "Retail Store",
            },
            {
              address: "456 Side St",
              buildingValue: 500000,
              contentsValue: null,
              occupancy: "Office",
            },
          ],
        }),
        ACORD_125: null,
      });

      await analyzeFinancialRatios(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const ratioCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "CONTENTS_TO_BUILDING_RATIO_ANOMALY",
      );
      expect(ratioCall).toBeUndefined();
    });

    it("skips when no property locations exist", async () => {
      setupSubmission();
      mockDocuments({
        ACORD_140: makeDoc("ACORD_140", {
          propertyLocations: [],
        }),
        ACORD_125: null,
      });

      await analyzeFinancialRatios(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const ratioCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "CONTENTS_TO_BUILDING_RATIO_ANOMALY",
      );
      expect(ratioCall).toBeUndefined();
    });
  });
});
