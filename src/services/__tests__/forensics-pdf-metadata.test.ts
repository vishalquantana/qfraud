import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { analyzePdfMetadata } from "@/services/forensics-pdf-metadata";

// ─── Mock dependencies ───────────────────────────────────

const mockPrisma = vi.mocked(prisma, true);

// Mock S3
vi.mock("@/lib/s3", () => ({
  getFromS3: vi.fn().mockResolvedValue(Buffer.from("fake-pdf-content")),
}));

// Mock pdf-parse — the dynamic import returns a named export PDFParse
// that is instantiated with `new PDFParse(...)`.
const mockGetText = vi.fn();
const mockGetInfo = vi.fn();
const mockDestroy = vi.fn().mockResolvedValue(undefined);

vi.mock("pdf-parse", () => {
  // Must use a real function (not arrow) so it can be called with `new`
  return {
    PDFParse: function MockPDFParse() {
      return {
        getText: mockGetText,
        getInfo: mockGetInfo,
        destroy: mockDestroy,
      };
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────

const DOCUMENT_ID = "doc-test-pdf";
const SUBMISSION_ID = "sub-test";
const TENANT_ID = "tenant-001";

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: DOCUMENT_ID,
    submissionId: SUBMISSION_ID,
    tenantId: TENANT_ID,
    fileName: "document.pdf",
    fileType: "application/pdf",
    s3Key: "tenant-001/sub-test/doc-test-pdf/document.pdf",
    documentType: "ACORD_125",
    status: "ANALYZED",
    createdAt: new Date("2025-06-01"),
    submission: {
      id: SUBMISSION_ID,
      tenantId: TENANT_ID,
      createdAt: new Date("2025-06-01"),
    },
    ...overrides,
  };
}

function setupPdfMetadata(metadata: {
  author?: string | null;
  producer?: string | null;
  creator?: string | null;
  creationDate?: Date | null;
  modDate?: Date | null;
  pageCount?: number;
  hasTextLayer?: boolean;
}) {
  const textContent = metadata.hasTextLayer !== false
    ? "This is a text layer with more than fifty characters of content for detection purposes."
    : "";

  mockGetText.mockResolvedValue({ text: textContent });

  const info: Record<string, unknown> = {};
  if (metadata.author !== undefined) info.Author = metadata.author;
  if (metadata.producer !== undefined) info.Producer = metadata.producer;
  if (metadata.creator !== undefined) info.Creator = metadata.creator;

  const dateNode: Record<string, Date | null> = {};
  if (metadata.creationDate !== undefined) dateNode.CreationDate = metadata.creationDate;
  if (metadata.modDate !== undefined) dateNode.ModDate = metadata.modDate;

  mockGetInfo.mockResolvedValue({
    total: metadata.pageCount ?? 1,
    info,
    getDateNode: () => dateNode,
  });
}

// ─── Tests ────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.fraudIndicator.create.mockResolvedValue({} as never);
});

describe("analyzePdfMetadata", () => {
  // ── Creator/producer mismatch ────────────────────────

  describe("creator/producer mismatch detection", () => {
    it("flags when creator and producer are different software", async () => {
      const doc = makeDocument();
      mockPrisma.document.findUniqueOrThrow.mockResolvedValue(doc as never);

      setupPdfMetadata({
        creator: "LibreOffice 7.4",
        producer: "Adobe Acrobat Pro DC",
        hasTextLayer: true,
      });

      await analyzePdfMetadata(DOCUMENT_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const mismatchCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "MULTIPLE_PDF_PRODUCERS",
      );

      expect(mismatchCall).toBeDefined();
      const data = (mismatchCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("MEDIUM");
      expect(data.category).toBe("FORENSIC");
    });

    it("does not flag when creator and producer are the same software", async () => {
      const doc = makeDocument();
      mockPrisma.document.findUniqueOrThrow.mockResolvedValue(doc as never);

      setupPdfMetadata({
        creator: "Adobe Acrobat Pro DC",
        producer: "Adobe Acrobat Pro DC",
        hasTextLayer: true,
      });

      await analyzePdfMetadata(DOCUMENT_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const mismatchCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "MULTIPLE_PDF_PRODUCERS",
      );
      expect(mismatchCall).toBeUndefined();
    });

    it("does not flag when creator and producer differ only in version number", async () => {
      const doc = makeDocument();
      mockPrisma.document.findUniqueOrThrow.mockResolvedValue(doc as never);

      setupPdfMetadata({
        creator: "Adobe Acrobat 10",
        producer: "Adobe Acrobat 11",
        hasTextLayer: true,
      });

      await analyzePdfMetadata(DOCUMENT_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const mismatchCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "MULTIPLE_PDF_PRODUCERS",
      );
      expect(mismatchCall).toBeUndefined();
    });
  });

  // ── Personal name in metadata ────────────────────────

  describe("personal name in metadata", () => {
    it("flags when author field contains a personal name", async () => {
      const doc = makeDocument();
      mockPrisma.document.findUniqueOrThrow.mockResolvedValue(doc as never);

      setupPdfMetadata({
        author: "John Smith",
        producer: "Adobe Acrobat",
        creator: "Adobe Acrobat",
        hasTextLayer: true,
      });

      await analyzePdfMetadata(DOCUMENT_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const nameCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "PERSONAL_NAME_IN_PDF_METADATA",
      );

      expect(nameCall).toBeDefined();
      const data = (nameCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("MEDIUM");
      expect(data.category).toBe("FORENSIC");
    });

    it("does not flag software names as personal names", async () => {
      const doc = makeDocument();
      mockPrisma.document.findUniqueOrThrow.mockResolvedValue(doc as never);

      setupPdfMetadata({
        author: "Adobe Acrobat Pro DC",
        producer: "Adobe Acrobat Pro DC",
        creator: "Adobe Acrobat Pro DC",
        hasTextLayer: true,
      });

      await analyzePdfMetadata(DOCUMENT_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const nameCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "PERSONAL_NAME_IN_PDF_METADATA",
      );
      expect(nameCall).toBeUndefined();
    });

    it("flags names with middle initials (e.g., 'John A. Smith')", async () => {
      const doc = makeDocument();
      mockPrisma.document.findUniqueOrThrow.mockResolvedValue(doc as never);

      setupPdfMetadata({
        author: "John A. Smith",
        producer: "Adobe Acrobat",
        creator: "Adobe Acrobat",
        hasTextLayer: true,
      });

      await analyzePdfMetadata(DOCUMENT_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const nameCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "PERSONAL_NAME_IN_PDF_METADATA",
      );
      expect(nameCall).toBeDefined();
    });
  });

  // ── Image-only PDF detection ─────────────────────────

  describe("image-only PDF detection", () => {
    it("flags PDFs with no text layer", async () => {
      const doc = makeDocument();
      mockPrisma.document.findUniqueOrThrow.mockResolvedValue(doc as never);

      setupPdfMetadata({
        author: null,
        producer: "ScanSnap",
        creator: "ScanSnap",
        hasTextLayer: false,
      });

      await analyzePdfMetadata(DOCUMENT_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const imageCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "IMAGE_ONLY_PDF",
      );

      expect(imageCall).toBeDefined();
      const data = (imageCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("MEDIUM");
      expect(data.category).toBe("FORENSIC");
    });

    it("does not flag PDFs with text layer", async () => {
      const doc = makeDocument();
      mockPrisma.document.findUniqueOrThrow.mockResolvedValue(doc as never);

      setupPdfMetadata({
        author: null,
        producer: "Adobe Acrobat",
        creator: "Adobe Acrobat",
        hasTextLayer: true,
      });

      await analyzePdfMetadata(DOCUMENT_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const imageCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "IMAGE_ONLY_PDF",
      );
      expect(imageCall).toBeUndefined();
    });
  });

  // ── Modification timeline anomalies ──────────────────

  describe("modification timeline anomalies", () => {
    it("flags PDF creation date after the submission date", async () => {
      // Submission date: June 1. PDF created June 10 => 9 days after
      const doc = makeDocument({
        submission: {
          id: SUBMISSION_ID,
          tenantId: TENANT_ID,
          createdAt: new Date("2025-06-01"),
        },
      });
      mockPrisma.document.findUniqueOrThrow.mockResolvedValue(doc as never);

      setupPdfMetadata({
        creationDate: new Date("2025-06-10"),
        modDate: new Date("2025-06-10"),
        hasTextLayer: true,
        author: null,
        producer: "Adobe Acrobat",
        creator: "Adobe Acrobat",
      });

      await analyzePdfMetadata(DOCUMENT_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const timelineCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "PDF_CREATED_AFTER_SUBMISSION",
      );

      expect(timelineCall).toBeDefined();
      const data = (timelineCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("HIGH");
      expect(data.category).toBe("FORENSIC");
    });

    it("does not flag when PDF creation date is before the submission date", async () => {
      const doc = makeDocument({
        submission: {
          id: SUBMISSION_ID,
          tenantId: TENANT_ID,
          createdAt: new Date("2025-06-15"),
        },
      });
      mockPrisma.document.findUniqueOrThrow.mockResolvedValue(doc as never);

      setupPdfMetadata({
        creationDate: new Date("2025-06-01"),
        modDate: new Date("2025-06-01"),
        hasTextLayer: true,
        author: null,
        producer: "Adobe Acrobat",
        creator: "Adobe Acrobat",
      });

      await analyzePdfMetadata(DOCUMENT_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const timelineCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "PDF_CREATED_AFTER_SUBMISSION",
      );
      expect(timelineCall).toBeUndefined();
    });
  });

  // ── Non-PDF file skip ────────────────────────────────

  describe("non-PDF handling", () => {
    it("skips non-PDF files without creating any indicators", async () => {
      const doc = makeDocument({
        fileName: "document.xlsx",
        fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      mockPrisma.document.findUniqueOrThrow.mockResolvedValue(doc as never);

      await analyzePdfMetadata(DOCUMENT_ID);

      expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
    });
  });
});
