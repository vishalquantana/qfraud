import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockExtractTextSmart = vi.fn();
const mockAiExtractForDocumentType = vi.fn();
const mockGetFromS3 = vi.fn();

vi.mock("@/services/extraction-ocr", () => ({
  extractTextSmart: (...args: unknown[]) => mockExtractTextSmart(...args),
  isImageBasedPdf: vi.fn(),
  ocrExtractText: vi.fn(),
}));

vi.mock("@/services/extraction-ai", () => ({
  aiExtractForDocumentType: (...args: unknown[]) => mockAiExtractForDocumentType(...args),
}));

vi.mock("@/lib/s3", () => ({
  getFromS3: (...args: unknown[]) => mockGetFromS3(...args),
}));

// Mock pdf-parse for regex extraction fallback
vi.mock("pdf-parse", () => {
  return {
    PDFParse: vi.fn().mockImplementation(() => ({
      getText: vi.fn().mockResolvedValue({ text: "" }),
      destroy: vi.fn(),
    })),
  };
});

import {
  dualExtract,
  crossValidateFields,
  type DualExtractionResult,
} from "@/services/extraction-dual";

describe("extraction-dual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── crossValidateFields ─────────────────────────────────

  describe("crossValidateFields", () => {
    it("returns high confidence when both methods agree on a string field", () => {
      const regexResult = { applicantName: "ABC Corp" };
      const aiResult = { applicantName: "ABC Corp" };

      const validation = crossValidateFields(regexResult, aiResult);

      expect(validation.applicantName.match).toBe(true);
      expect(validation.applicantName.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("returns high confidence when both agree on a numeric field", () => {
      const regexResult = { annualRevenue: 5000000 };
      const aiResult = { annualRevenue: 5000000 };

      const validation = crossValidateFields(regexResult, aiResult);

      expect(validation.annualRevenue.match).toBe(true);
      expect(validation.annualRevenue.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("returns medium confidence when values are close but not exact (string fuzzy match)", () => {
      const regexResult = { applicantName: "ABC Corp LLC" };
      const aiResult = { applicantName: "ABC Corp, LLC" };

      const validation = crossValidateFields(regexResult, aiResult);

      // Close match — should still be considered matching
      expect(validation.applicantName.confidence).toBeGreaterThan(0.5);
    });

    it("returns low confidence when values disagree", () => {
      const regexResult = { annualRevenue: 5000000 };
      const aiResult = { annualRevenue: 8000000 };

      const validation = crossValidateFields(regexResult, aiResult);

      expect(validation.annualRevenue.match).toBe(false);
      expect(validation.annualRevenue.confidence).toBeLessThan(0.5);
    });

    it("handles null/missing values from one method", () => {
      const regexResult = { applicantName: null, annualRevenue: 5000000 };
      const aiResult = { applicantName: "ABC Corp", annualRevenue: 5000000 };

      const validation = crossValidateFields(regexResult, aiResult);

      // When one is null and the other has a value, use the available value with lower confidence
      expect(validation.applicantName.match).toBe(false);
      expect(validation.applicantName.confidence).toBeLessThan(0.7);
    });

    it("handles both values being null", () => {
      const regexResult = { applicantName: null };
      const aiResult = { applicantName: null };

      const validation = crossValidateFields(regexResult, aiResult);

      // Both null = agreement on absence
      expect(validation.applicantName.match).toBe(true);
    });

    it("handles numeric close-enough matching (within 5%)", () => {
      const regexResult = { annualRevenue: 5000000 };
      const aiResult = { annualRevenue: 5050000 }; // 1% diff

      const validation = crossValidateFields(regexResult, aiResult);

      expect(validation.annualRevenue.match).toBe(true);
      expect(validation.annualRevenue.confidence).toBeGreaterThan(0.7);
    });
  });

  // ─── dualExtract ─────────────────────────────────────────

  describe("dualExtract", () => {
    it("runs both regex and AI extraction and returns merged result", async () => {
      const text = "ACORD 125\nApplicant Name: ABC Corp\nAnnual Revenue: $5,000,000";
      mockExtractTextSmart.mockResolvedValue({
        text,
        source: "pdf-parse",
        isOcr: false,
        pageCount: 1,
      });

      mockAiExtractForDocumentType.mockResolvedValue({
        applicantName: "ABC Corp",
        annualRevenue: 5000000,
        numberOfEmployees: 50,
        _metadata: { source: "gemini-ai" },
      });

      const result = await dualExtract("s3key/doc.pdf", "ACORD_125");

      expect(result).not.toBeNull();
      expect(result!.mergedData).toBeDefined();
      expect(result!.textSource).toBe("pdf-parse");
      expect(result!.aiAvailable).toBe(true);
    });

    it("returns regex-only result when AI is unavailable", async () => {
      const text = "Applicant Name: ABC Corp\nAnnual Revenue: $5,000,000";
      mockExtractTextSmart.mockResolvedValue({
        text,
        source: "pdf-parse",
        isOcr: false,
        pageCount: 1,
      });

      mockAiExtractForDocumentType.mockResolvedValue(null);

      const result = await dualExtract("s3key/doc.pdf", "ACORD_125");

      expect(result).not.toBeNull();
      expect(result!.aiAvailable).toBe(false);
      // Should still have data from regex extraction
      expect(result!.mergedData).toBeDefined();
    });

    it("returns AI-only result when text extraction produces minimal content", async () => {
      mockExtractTextSmart.mockResolvedValue({
        text: "",
        source: "pdf-parse",
        isOcr: false,
        pageCount: 1,
      });

      mockAiExtractForDocumentType.mockResolvedValue({
        applicantName: "From AI Only",
        _metadata: { source: "gemini-ai" },
      });

      const result = await dualExtract("s3key/doc.pdf", "ACORD_125");

      expect(result).not.toBeNull();
      // Merged data should use AI values when regex has nothing
      expect(result!.mergedData.applicantName).toBe("From AI Only");
    });

    it("prefers agreed-upon values when both methods produce results", async () => {
      const text = "ACORD 125\nApplicant Name: ABC Corp\nAnnual Revenue: $5,000,000";
      mockExtractTextSmart.mockResolvedValue({
        text,
        source: "pdf-parse",
        isOcr: false,
        pageCount: 1,
      });

      mockAiExtractForDocumentType.mockResolvedValue({
        applicantName: "ABC Corp",
        annualRevenue: 5000000,
        _metadata: { source: "gemini-ai" },
      });

      const result = await dualExtract("s3key/doc.pdf", "ACORD_125");

      expect(result!.validation).toBeDefined();
      // Fields that agree should have high confidence
      const applicantValidation = result!.validation?.applicantName;
      if (applicantValidation) {
        expect(applicantValidation.confidence).toBeGreaterThan(0.7);
      }
    });

    it("includes extraction metadata with confidence scores", async () => {
      mockExtractTextSmart.mockResolvedValue({
        text: "Some text",
        source: "tesseract-ocr",
        isOcr: true,
        pageCount: 3,
      });

      mockAiExtractForDocumentType.mockResolvedValue({
        applicantName: "Test Corp",
        _metadata: { source: "gemini-ai" },
      });

      const result = await dualExtract("s3key/doc.pdf", "ACORD_125");

      expect(result).not.toBeNull();
      expect(result!.textSource).toBe("tesseract-ocr");
      expect(result!.isOcr).toBe(true);
      expect(result!.pageCount).toBe(3);
    });

    it("handles unsupported document types gracefully", async () => {
      mockExtractTextSmart.mockResolvedValue({
        text: "Some document text",
        source: "pdf-parse",
        isOcr: false,
        pageCount: 1,
      });

      mockAiExtractForDocumentType.mockResolvedValue(null);

      const result = await dualExtract("s3key/doc.pdf", "UNKNOWN_TYPE");

      expect(result).not.toBeNull();
      expect(result!.aiAvailable).toBe(false);
    });

    it("returns overall confidence score based on cross-validation", async () => {
      const text = "Applicant: ABC Corp\nRevenue: $5,000,000";
      mockExtractTextSmart.mockResolvedValue({
        text,
        source: "pdf-parse",
        isOcr: false,
        pageCount: 1,
      });

      mockAiExtractForDocumentType.mockResolvedValue({
        applicantName: "ABC Corp",
        annualRevenue: 5000000,
        _metadata: { source: "gemini-ai" },
      });

      const result = await dualExtract("s3key/doc.pdf", "ACORD_125");

      expect(result!.overallConfidence).toBeDefined();
      expect(result!.overallConfidence).toBeGreaterThanOrEqual(0);
      expect(result!.overallConfidence).toBeLessThanOrEqual(1);
    });
  });

  // ─── DualExtractionResult type ───────────────────────────

  describe("DualExtractionResult type", () => {
    it("includes all required fields", async () => {
      mockExtractTextSmart.mockResolvedValue({
        text: "text",
        source: "pdf-parse",
        isOcr: false,
        pageCount: 1,
      });
      mockAiExtractForDocumentType.mockResolvedValue(null);

      const result: DualExtractionResult | null = await dualExtract(
        "s3key/doc.pdf",
        "ACORD_125",
      );

      expect(result).not.toBeNull();
      expect(result).toHaveProperty("mergedData");
      expect(result).toHaveProperty("textSource");
      expect(result).toHaveProperty("isOcr");
      expect(result).toHaveProperty("aiAvailable");
      expect(result).toHaveProperty("overallConfidence");
    });
  });
});
