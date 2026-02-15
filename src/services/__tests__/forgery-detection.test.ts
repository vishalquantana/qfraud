import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockGeminiAnalyze = vi.fn();
const mockGeminiAnalyzeWithImage = vi.fn();
const mockGeminiStructuredAnalysis = vi.fn();

vi.mock("@/lib/gemini", () => ({
  geminiAnalyze: (...args: unknown[]) => mockGeminiAnalyze(...args),
  geminiAnalyzeWithImage: (...args: unknown[]) => mockGeminiAnalyzeWithImage(...args),
  geminiStructuredAnalysis: (...args: unknown[]) => mockGeminiStructuredAnalysis(...args),
}));

vi.mock("@/lib/s3", () => ({
  getFromS3: vi.fn().mockResolvedValue(Buffer.from("fake-pdf-content")),
}));

import {
  analyzeDocumentForgery,
  analyzeImageForgery,
  type ForgeryAnalysisResult,
} from "@/services/forgery-detection";
import { prisma } from "@/lib/prisma";
import { DOCUMENTS, SUBMISSION, TENANT } from "@/test/fixtures";

describe("analyzeDocumentForgery", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: document exists
    vi.mocked(prisma.document.findUniqueOrThrow).mockResolvedValue({
      ...DOCUMENTS.acord125,
      submission: SUBMISSION.clean,
    } as never);
  });

  it("returns forgery analysis from Gemini structured response", async () => {
    const mockResult: ForgeryAnalysisResult = {
      isSuspicious: true,
      confidenceScore: 0.85,
      findings: [
        {
          type: "FONT_INCONSISTENCY",
          description: "Multiple font families detected in amounts section",
          severity: "HIGH",
          evidence: "Line items use Calibri but totals use Arial",
        },
      ],
      overallAssessment: "Document shows signs of modification in financial data sections",
    };
    mockGeminiStructuredAnalysis.mockResolvedValue(mockResult);

    const result = await analyzeDocumentForgery("doc-acord125");

    expect(result).toEqual(mockResult);
    expect(mockGeminiStructuredAnalysis).toHaveBeenCalledWith(
      expect.stringContaining("forgery"),
      expect.stringContaining("ACORD_125"),
    );
  });

  it("returns null when Gemini API is unavailable", async () => {
    mockGeminiStructuredAnalysis.mockResolvedValue(null);

    const result = await analyzeDocumentForgery("doc-acord125");
    expect(result).toBeNull();
  });

  it("creates fraud indicators for suspicious findings", async () => {
    const mockResult: ForgeryAnalysisResult = {
      isSuspicious: true,
      confidenceScore: 0.9,
      findings: [
        {
          type: "ALTERED_AMOUNTS",
          description: "Financial amounts appear to be modified",
          severity: "CRITICAL",
          evidence: "White-out marks visible under revenue figures",
        },
        {
          type: "MISMATCHED_DATES",
          description: "Document dates inconsistent",
          severity: "HIGH",
          evidence: "Header shows 2024 but footer shows 2023",
        },
      ],
      overallAssessment: "Strong indicators of document tampering",
    };
    mockGeminiStructuredAnalysis.mockResolvedValue(mockResult);
    vi.mocked(prisma.fraudIndicator.create).mockResolvedValue({} as never);

    await analyzeDocumentForgery("doc-acord125", { createIndicators: true });

    // Should create one indicator per finding
    expect(prisma.fraudIndicator.create).toHaveBeenCalledTimes(2);
    expect(prisma.fraudIndicator.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submissionId: SUBMISSION.clean.id,
        tenantId: TENANT.id,
        category: "FORENSIC",
        indicatorName: "AI_FORGERY_ALTERED_AMOUNTS",
        severity: "CRITICAL",
        confidence: 0.9,
      }),
    });
  });

  it("does NOT create indicators when createIndicators is false", async () => {
    mockGeminiStructuredAnalysis.mockResolvedValue({
      isSuspicious: true,
      confidenceScore: 0.7,
      findings: [{ type: "TEST", description: "test", severity: "LOW", evidence: "test" }],
      overallAssessment: "test",
    });

    await analyzeDocumentForgery("doc-acord125", { createIndicators: false });

    expect(prisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("does NOT create indicators for non-suspicious results", async () => {
    mockGeminiStructuredAnalysis.mockResolvedValue({
      isSuspicious: false,
      confidenceScore: 0.1,
      findings: [],
      overallAssessment: "Document appears authentic",
    });

    await analyzeDocumentForgery("doc-acord125", { createIndicators: true });

    expect(prisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("includes document metadata in the prompt context", async () => {
    mockGeminiStructuredAnalysis.mockResolvedValue(null);

    await analyzeDocumentForgery("doc-acord125");

    const contextArg = mockGeminiStructuredAnalysis.mock.calls[0][1] as string;
    expect(contextArg).toContain("ACORD_125");
    expect(contextArg).toContain(DOCUMENTS.acord125.fileName);
  });
});

describe("analyzeImageForgery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends image buffer to Gemini vision API", async () => {
    const imageBuffer = Buffer.from("fake-image-data");
    mockGeminiAnalyzeWithImage.mockResolvedValue(
      JSON.stringify({
        isSuspicious: false,
        confidenceScore: 0.1,
        findings: [],
        overallAssessment: "Image appears genuine",
      }),
    );

    await analyzeImageForgery(imageBuffer, "image/jpeg");

    expect(mockGeminiAnalyzeWithImage).toHaveBeenCalledWith(
      expect.stringContaining("forgery"),
      imageBuffer,
      "image/jpeg",
    );
  });

  it("returns null when Gemini returns null", async () => {
    mockGeminiAnalyzeWithImage.mockResolvedValue(null);

    const result = await analyzeImageForgery(
      Buffer.from("fake"),
      "image/png",
    );
    expect(result).toBeNull();
  });

  it("returns parsed analysis result", async () => {
    const expected: ForgeryAnalysisResult = {
      isSuspicious: true,
      confidenceScore: 0.75,
      findings: [
        {
          type: "DIGITAL_MANIPULATION",
          description: "Image shows signs of pixel manipulation",
          severity: "HIGH",
          evidence: "ELA analysis shows inconsistent compression in signature area",
        },
      ],
      overallAssessment: "Image likely manipulated",
    };
    mockGeminiAnalyzeWithImage.mockResolvedValue(JSON.stringify(expected));

    const result = await analyzeImageForgery(
      Buffer.from("fake"),
      "image/jpeg",
    );
    expect(result).toEqual(expected);
  });

  it("returns null on JSON parse failure", async () => {
    mockGeminiAnalyzeWithImage.mockResolvedValue("not valid json");

    const result = await analyzeImageForgery(
      Buffer.from("fake"),
      "image/jpeg",
    );
    expect(result).toBeNull();
  });
});
