import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockGeminiStructuredAnalysis = vi.fn();

vi.mock("@/lib/gemini", () => ({
  geminiStructuredAnalysis: (...args: unknown[]) => mockGeminiStructuredAnalysis(...args),
}));

import {
  aiExtractAcord125,
  aiExtractFinancialStatement,
  aiExtractLossRun,
  aiExtractCOI,
  aiExtractForDocumentType,
  type AIExtractionResult,
} from "@/services/extraction-ai";

describe("extraction-ai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── ACORD 125 AI Extraction ──────────────────────────────

  describe("aiExtractAcord125", () => {
    it("returns structured ACORD 125 data from Gemini", async () => {
      const mockResult = {
        applicantName: "ABC Manufacturing LLC",
        businessName: "ABC Manufacturing",
        annualRevenue: 5000000,
        numberOfEmployees: 50,
        naicsCode: "332710",
        effectiveDate: "2025-07-01",
        expirationDate: "2026-07-01",
        lossDisclosure: true,
        requestedCoverages: ["GENERAL LIABILITY", "COMMERCIAL PROPERTY"],
      };
      mockGeminiStructuredAnalysis.mockResolvedValue(mockResult);

      const result = await aiExtractAcord125("Full text of ACORD 125 form...");

      expect(result).not.toBeNull();
      expect(result!.applicantName).toBe("ABC Manufacturing LLC");
      expect(result!.annualRevenue).toBe(5000000);
      expect(mockGeminiStructuredAnalysis).toHaveBeenCalledWith(
        expect.stringContaining("ACORD 125"),
        expect.stringContaining("Full text of ACORD 125"),
      );
    });

    it("returns null when Gemini is unavailable", async () => {
      mockGeminiStructuredAnalysis.mockResolvedValue(null);

      const result = await aiExtractAcord125("Some text");
      expect(result).toBeNull();
    });

    it("includes the extraction prompt with expected fields", async () => {
      mockGeminiStructuredAnalysis.mockResolvedValue(null);

      await aiExtractAcord125("document text");

      const prompt = mockGeminiStructuredAnalysis.mock.calls[0][0] as string;
      expect(prompt).toContain("applicantName");
      expect(prompt).toContain("annualRevenue");
      expect(prompt).toContain("numberOfEmployees");
      expect(prompt).toContain("naicsCode");
    });
  });

  // ─── Financial Statement AI Extraction ────────────────────

  describe("aiExtractFinancialStatement", () => {
    it("returns structured financial data from Gemini", async () => {
      const mockResult = {
        fiscalYear: "2024",
        revenue: 5000000,
        costOfGoodsSold: 3500000,
        grossProfit: 1500000,
        netIncome: 400000,
        totalAssets: 8000000,
        totalLiabilities: 5000000,
      };
      mockGeminiStructuredAnalysis.mockResolvedValue(mockResult);

      const result = await aiExtractFinancialStatement("Balance sheet and P&L text");

      expect(result).not.toBeNull();
      expect(result!.revenue).toBe(5000000);
      expect(result!.netIncome).toBe(400000);
    });

    it("returns null when Gemini is unavailable", async () => {
      mockGeminiStructuredAnalysis.mockResolvedValue(null);

      const result = await aiExtractFinancialStatement("text");
      expect(result).toBeNull();
    });
  });

  // ─── Loss Run AI Extraction ──────────────────────────────

  describe("aiExtractLossRun", () => {
    it("returns structured loss run data from Gemini", async () => {
      const mockResult = {
        carrierName: "Hartford Insurance",
        policyPeriod: "2023-2024",
        claims: [
          {
            claimNumber: "CLM-001",
            dateOfLoss: "2023-06-15",
            claimType: "General Liability",
            status: "Closed",
            paidAmount: 25000,
            reserveAmount: 0,
            totalIncurred: 25000,
          },
        ],
        totalClaimCount: 1,
        totalIncurred: 25000,
      };
      mockGeminiStructuredAnalysis.mockResolvedValue(mockResult);

      const result = await aiExtractLossRun("Loss run report text...");

      expect(result).not.toBeNull();
      expect(result!.claims).toHaveLength(1);
      expect(result!.claims[0].paidAmount).toBe(25000);
      expect(result!.totalIncurred).toBe(25000);
    });

    it("returns null when Gemini is unavailable", async () => {
      mockGeminiStructuredAnalysis.mockResolvedValue(null);

      const result = await aiExtractLossRun("text");
      expect(result).toBeNull();
    });
  });

  // ─── COI AI Extraction ────────────────────────────────────

  describe("aiExtractCOI", () => {
    it("returns structured COI data from Gemini", async () => {
      const mockResult = {
        insuredName: "ABC Manufacturing LLC",
        insurerName: "Hartford Insurance",
        policyNumber: "GL-2025-001",
        effectiveDate: "2025-01-01",
        expirationDate: "2026-01-01",
        coverageTypes: ["General Liability", "Commercial Auto"],
        generalLiabilityLimit: 1000000,
      };
      mockGeminiStructuredAnalysis.mockResolvedValue(mockResult);

      const result = await aiExtractCOI("Certificate of Insurance text...");

      expect(result).not.toBeNull();
      expect(result!.insuredName).toBe("ABC Manufacturing LLC");
      expect(result!.policyNumber).toBe("GL-2025-001");
    });

    it("returns null when Gemini is unavailable", async () => {
      mockGeminiStructuredAnalysis.mockResolvedValue(null);

      const result = await aiExtractCOI("text");
      expect(result).toBeNull();
    });
  });

  // ─── Document Type Router ────────────────────────────────

  describe("aiExtractForDocumentType", () => {
    it("routes ACORD_125 to the correct extractor", async () => {
      const mockResult = { applicantName: "Test Corp" };
      mockGeminiStructuredAnalysis.mockResolvedValue(mockResult);

      const result = await aiExtractForDocumentType("ACORD_125", "text");

      expect(result).not.toBeNull();
      expect(mockGeminiStructuredAnalysis).toHaveBeenCalledWith(
        expect.stringContaining("ACORD 125"),
        expect.any(String),
      );
    });

    it("routes FINANCIAL_STATEMENT to the correct extractor", async () => {
      const mockResult = { revenue: 1000000 };
      mockGeminiStructuredAnalysis.mockResolvedValue(mockResult);

      const result = await aiExtractForDocumentType("FINANCIAL_STATEMENT", "text");

      expect(result).not.toBeNull();
      expect(mockGeminiStructuredAnalysis).toHaveBeenCalledWith(
        expect.stringContaining("financial statement"),
        expect.any(String),
      );
    });

    it("routes LOSS_RUN to the correct extractor", async () => {
      mockGeminiStructuredAnalysis.mockResolvedValue({ claims: [] });
      await aiExtractForDocumentType("LOSS_RUN", "text");

      expect(mockGeminiStructuredAnalysis).toHaveBeenCalledWith(
        expect.stringContaining("loss run"),
        expect.any(String),
      );
    });

    it("routes COI to the correct extractor", async () => {
      mockGeminiStructuredAnalysis.mockResolvedValue({ insuredName: "Test" });
      await aiExtractForDocumentType("COI", "text");

      expect(mockGeminiStructuredAnalysis).toHaveBeenCalledWith(
        expect.stringContaining("Certificate of Insurance"),
        expect.any(String),
      );
    });

    it("returns null for unsupported document types", async () => {
      const result = await aiExtractForDocumentType("UNKNOWN_TYPE", "text");
      expect(result).toBeNull();
      expect(mockGeminiStructuredAnalysis).not.toHaveBeenCalled();
    });
  });

  // ─── AIExtractionResult metadata ─────────────────────────

  describe("result metadata", () => {
    it("wraps AI result with confidence source metadata", async () => {
      const mockResult = { applicantName: "Test Corp", annualRevenue: 1000000 };
      mockGeminiStructuredAnalysis.mockResolvedValue(mockResult);

      const result: AIExtractionResult | null = await aiExtractForDocumentType("ACORD_125", "text");

      expect(result).not.toBeNull();
      expect(result!._metadata).toBeDefined();
      expect(result!._metadata.source).toBe("gemini-ai");
    });
  });
});
