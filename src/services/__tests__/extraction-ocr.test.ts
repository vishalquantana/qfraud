import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockCreateWorker = vi.fn();
const mockGetFromS3 = vi.fn();

vi.mock("tesseract.js", () => ({
  createWorker: (...args: unknown[]) => mockCreateWorker(...args),
}));

vi.mock("@/lib/s3", () => ({
  getFromS3: (...args: unknown[]) => mockGetFromS3(...args),
}));

// Mock pdf-parse — dynamic import. Must use a class so `new PDFParse()` works.
const mockGetText = vi.fn();
const mockDestroy = vi.fn().mockResolvedValue(undefined);

vi.mock("pdf-parse", () => {
  class MockPDFParse {
    getText = mockGetText;
    destroy = mockDestroy;
  }
  return { PDFParse: MockPDFParse };
});

import {
  extractTextSmart,
  isImageBasedPdf,
  ocrExtractText,
} from "@/services/extraction-ocr";

describe("extraction-ocr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── isImageBasedPdf ─────────────────────────────────────

  describe("isImageBasedPdf", () => {
    it("returns true when extracted text is too short", () => {
      // Scanned PDFs produce minimal text from pdf-parse
      expect(isImageBasedPdf("", 3)).toBe(true);
      expect(isImageBasedPdf("   ", 1)).toBe(true);
    });

    it("returns true when text-per-page ratio is very low", () => {
      // 5 pages but only 20 chars = 4 chars/page → image-based
      expect(isImageBasedPdf("Some short text here.", 5)).toBe(true);
    });

    it("returns false when text has substantial content", () => {
      const substantialText = "ACORD 125 COMMERCIAL INSURANCE APPLICATION ".repeat(50);
      expect(isImageBasedPdf(substantialText, 3)).toBe(false);
    });

    it("returns false for single page with reasonable text", () => {
      const text = "Applicant Name: ABC Manufacturing LLC\nAnnual Revenue: $5,000,000\n";
      expect(isImageBasedPdf(text, 1)).toBe(false);
    });
  });

  // ─── ocrExtractText ──────────────────────────────────────

  describe("ocrExtractText", () => {
    it("creates a Tesseract worker and processes an image buffer", async () => {
      const mockWorker = {
        recognize: vi.fn().mockResolvedValue({
          data: { text: "OCR extracted text from image" },
        }),
        terminate: vi.fn().mockResolvedValue(undefined),
      };
      mockCreateWorker.mockResolvedValue(mockWorker);

      const imageBuffer = Buffer.from("fake-image-data");
      const result = await ocrExtractText(imageBuffer);

      expect(result).toBe("OCR extracted text from image");
      expect(mockCreateWorker).toHaveBeenCalledWith("eng");
      expect(mockWorker.recognize).toHaveBeenCalledWith(imageBuffer);
      expect(mockWorker.terminate).toHaveBeenCalled();
    });

    it("terminates the worker even on error", async () => {
      const mockWorker = {
        recognize: vi.fn().mockRejectedValue(new Error("OCR failed")),
        terminate: vi.fn().mockResolvedValue(undefined),
      };
      mockCreateWorker.mockResolvedValue(mockWorker);

      await expect(ocrExtractText(Buffer.from("bad"))).rejects.toThrow("OCR failed");
      expect(mockWorker.terminate).toHaveBeenCalled();
    });

    it("returns empty string when OCR produces no text", async () => {
      const mockWorker = {
        recognize: vi.fn().mockResolvedValue({
          data: { text: "" },
        }),
        terminate: vi.fn().mockResolvedValue(undefined),
      };
      mockCreateWorker.mockResolvedValue(mockWorker);

      const result = await ocrExtractText(Buffer.from("empty-image"));
      expect(result).toBe("");
    });
  });

  // ─── extractTextSmart ────────────────────────────────────

  describe("extractTextSmart", () => {
    it("uses pdf-parse for text-based PDFs", async () => {
      const pdfBuffer = Buffer.from("fake-pdf-content");
      mockGetFromS3.mockResolvedValue(pdfBuffer);
      const richText = "ACORD 125 APPLICATION\nApplicant: ABC Corp\nRevenue: $5M\n".repeat(10);
      mockGetText.mockResolvedValue({ text: richText });

      const result = await extractTextSmart("s3key/doc.pdf");

      expect(result.text).toBe(richText);
      expect(result.source).toBe("pdf-parse");
      expect(result.isOcr).toBe(false);
    });

    it("falls back to OCR when pdf-parse returns minimal text", async () => {
      const pdfBuffer = Buffer.from("fake-scanned-pdf");
      mockGetFromS3.mockResolvedValue(pdfBuffer);
      mockGetText.mockResolvedValue({ text: "", numpages: 3 });

      const mockWorker = {
        recognize: vi.fn().mockResolvedValue({
          data: { text: "OCR text from scanned PDF" },
        }),
        terminate: vi.fn().mockResolvedValue(undefined),
      };
      mockCreateWorker.mockResolvedValue(mockWorker);

      const result = await extractTextSmart("s3key/doc.pdf");

      expect(result.text).toBe("OCR text from scanned PDF");
      expect(result.source).toBe("tesseract-ocr");
      expect(result.isOcr).toBe(true);
    });

    it("uses pdf-parse for non-PDF files with text content", async () => {
      const buffer = Buffer.from("text content");
      mockGetFromS3.mockResolvedValue(buffer);
      // Must exceed 50 chars/page threshold to be considered text-based
      mockGetText.mockResolvedValue({
        text: "This document contains enough text content to pass the threshold for detection as a text-based PDF file.",
      });

      const result = await extractTextSmart("s3key/doc.pdf");

      expect(result.source).toBe("pdf-parse");
    });

    it("directly uses OCR for image files (jpg/png)", async () => {
      const imageBuffer = Buffer.from("fake-image-bytes");
      mockGetFromS3.mockResolvedValue(imageBuffer);

      const mockWorker = {
        recognize: vi.fn().mockResolvedValue({
          data: { text: "Text extracted from image" },
        }),
        terminate: vi.fn().mockResolvedValue(undefined),
      };
      mockCreateWorker.mockResolvedValue(mockWorker);

      const result = await extractTextSmart("s3key/doc.jpg");

      expect(result.text).toBe("Text extracted from image");
      expect(result.source).toBe("tesseract-ocr");
      expect(result.isOcr).toBe(true);
      // Should not attempt pdf-parse for images
    });

    it("includes page count in result when available", async () => {
      const pdfBuffer = Buffer.from("multi-page-pdf");
      mockGetFromS3.mockResolvedValue(pdfBuffer);
      const text = "Page 1 content ".repeat(100);
      mockGetText.mockResolvedValue({ text, numpages: 5 });

      const result = await extractTextSmart("s3key/doc.pdf");

      expect(result.pageCount).toBe(5);
    });

    it("throws when both pdf-parse and OCR fail", async () => {
      mockGetFromS3.mockResolvedValue(Buffer.from("corrupted"));
      mockGetText.mockResolvedValue({ text: "", numpages: 1 });

      const mockWorker = {
        recognize: vi.fn().mockRejectedValue(new Error("OCR engine error")),
        terminate: vi.fn().mockResolvedValue(undefined),
      };
      mockCreateWorker.mockResolvedValue(mockWorker);

      await expect(extractTextSmart("s3key/doc.pdf")).rejects.toThrow("OCR engine error");
    });
  });
});
