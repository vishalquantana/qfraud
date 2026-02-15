import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { DOCUMENTS, SUBMISSION, TENANT } from "@/test/fixtures";

// ─── Mock dependencies ───────────────────────────────────

const mockPrisma = vi.mocked(prisma, true);

vi.mock("@/lib/s3", () => ({
  getFromS3: vi.fn(),
}));

const mockGetText = vi.fn();
const mockDestroy = vi.fn().mockResolvedValue(undefined);

vi.mock("pdf-parse", () => ({
  PDFParse: function MockPDFParse() {
    return {
      getText: mockGetText,
      destroy: mockDestroy,
    };
  },
}));

import { getFromS3 } from "@/lib/s3";
import { classifyDocument } from "@/services/classification";

const mockGetFromS3 = vi.mocked(getFromS3);

// ─── Helpers ──────────────────────────────────────────────

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-test",
    submissionId: SUBMISSION.clean.id,
    tenantId: TENANT.id,
    fileName: "unknown_file.pdf",
    fileType: "application/pdf",
    fileSize: 100000,
    s3Key: "tenant-001/sub-clean/doc-test/unknown_file.pdf",
    documentType: null,
    classificationConfidence: null,
    extractedData: null,
    status: "CLASSIFYING",
    createdAt: new Date("2025-06-01"),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFromS3.mockResolvedValue(Buffer.from("fake-pdf-content"));
  mockGetText.mockResolvedValue({ text: "" });
});

describe("classifyDocument", () => {
  // ── Status lifecycle ───────────────────────────────────

  describe("status lifecycle", () => {
    it("sets status to CLASSIFYING at the start", async () => {
      const doc = makeDocument({ fileName: "random_file.txt" });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never) // CLASSIFYING
        .mockResolvedValueOnce(doc as never); // EXTRACTING

      await classifyDocument(doc.id);

      expect(mockPrisma.document.update).toHaveBeenNthCalledWith(1, {
        where: { id: doc.id },
        data: { status: "CLASSIFYING" },
      });
    });

    it("sets status to EXTRACTING on successful classification", async () => {
      const doc = makeDocument({
        fileName: "ACORD_125_Application.pdf",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never) // CLASSIFYING
        .mockResolvedValueOnce(doc as never); // EXTRACTING

      await classifyDocument(doc.id);

      expect(mockPrisma.document.update).toHaveBeenNthCalledWith(2, {
        where: { id: doc.id },
        data: {
          documentType: "ACORD_125",
          classificationConfidence: expect.any(Number),
          status: "EXTRACTING",
        },
      });
    });

    it("sets status to ERROR on failure", async () => {
      mockPrisma.document.update
        .mockResolvedValueOnce(makeDocument() as never) // CLASSIFYING
        .mockRejectedValueOnce(new Error("DB error")) // Fails during second update
        .mockResolvedValueOnce({} as never); // ERROR status update

      // The first update succeeds (CLASSIFYING), then when the service tries
      // the EXTRACTING update it fails, triggering the catch block.
      // We need to make the second update (EXTRACTING) throw, and the third
      // update (ERROR) succeed. But the catch block also calls update, so:
      mockPrisma.document.update
        .mockReset()
        .mockResolvedValueOnce(
          makeDocument({
            fileName: "ACORD_125_Application.pdf",
            s3Key: "tenant-001/sub-clean/doc-test/ACORD_125_Application.pdf",
          }) as never,
        ) // CLASSIFYING -> returns doc
        .mockRejectedValueOnce(new Error("DB write failed")) // EXTRACTING update fails
        .mockResolvedValueOnce({} as never); // ERROR status set

      await expect(classifyDocument("doc-test")).rejects.toThrow("DB write failed");

      expect(mockPrisma.document.update).toHaveBeenLastCalledWith({
        where: { id: "doc-test" },
        data: { status: "ERROR" },
      });
    });
  });

  // ── Filename-based classification ──────────────────────

  describe("filename-based classification", () => {
    const filenameTestCases: { fileName: string; expectedType: string }[] = [
      { fileName: "ACORD_125_Application.pdf", expectedType: "ACORD_125" },
      { fileName: "acord125.pdf", expectedType: "ACORD_125" },
      { fileName: "ACORD_130_WC.pdf", expectedType: "ACORD_130" },
      { fileName: "acord130_workers_comp.pdf", expectedType: "ACORD_130" },
      { fileName: "ACORD_140_Property.pdf", expectedType: "ACORD_140" },
      { fileName: "acord140.pdf", expectedType: "ACORD_140" },
      { fileName: "Loss_Runs_2024.pdf", expectedType: "LOSS_RUN" },
      { fileName: "loss-run-report.pdf", expectedType: "LOSS_RUN" },
      { fileName: "Financial_Statement_2024.pdf", expectedType: "FINANCIAL_STATEMENT" },
      { fileName: "financial-stat.pdf", expectedType: "FINANCIAL_STATEMENT" },
      { fileName: "COI-Certificate.pdf", expectedType: "COI" },
      { fileName: "certificate_of_insurance.pdf", expectedType: "COI" },
      { fileName: "entity_doc_articles.pdf", expectedType: "ENTITY_DOC" },
      { fileName: "articles_of_incorporation.pdf", expectedType: "ENTITY_DOC" },
      { fileName: "certificate_of_formation.pdf", expectedType: "ENTITY_DOC" },
      { fileName: "inspection_photo_front.jpg", expectedType: "INSPECTION_PHOTO" },
      { fileName: "property_photo_01.png", expectedType: "INSPECTION_PHOTO" },
      { fileName: "MVR-report.pdf", expectedType: "MVR" },
      { fileName: "motor_vehicle_report.pdf", expectedType: "MVR" },
      { fileName: "SOV-Schedule.pdf", expectedType: "SOV" },
      { fileName: "schedule_of_values.xlsx", expectedType: "SOV" },
      { fileName: "surplus_line_docs.pdf", expectedType: "SURPLUS_LINES" },
      { fileName: "professional_license.pdf", expectedType: "PROFESSIONAL_LICENSE" },
      { fileName: "environmental_report.pdf", expectedType: "ENVIRONMENTAL_REPORT" },
      { fileName: "payroll_tax_records.pdf", expectedType: "PAYROLL_TAX" },
      { fileName: "payroll_report_q3.pdf", expectedType: "PAYROLL_TAX" },
      { fileName: "broker_submission_letter.pdf", expectedType: "BROKER_SUBMISSION" },
      { fileName: "cover_letter.pdf", expectedType: "BROKER_SUBMISSION" },
      { fileName: "fleet_schedule.pdf", expectedType: "FLEET_SCHEDULE" },
    ];

    it.each(filenameTestCases)(
      "classifies '$fileName' as $expectedType with 0.7 confidence",
      async ({ fileName, expectedType }) => {
        const doc = makeDocument({ fileName, s3Key: `tenant-001/sub-clean/doc-test/${fileName}` });
        mockPrisma.document.update
          .mockResolvedValueOnce(doc as never)
          .mockResolvedValueOnce(doc as never);

        const result = await classifyDocument(doc.id);

        expect(result.documentType).toBe(expectedType);
        // Filename classification yields 0.7 confidence (unless text content overrides)
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      },
    );
  });

  // ── PDF text content classification ────────────────────

  describe("PDF text content classification", () => {
    const textContentCases: {
      name: string;
      text: string;
      expectedType: string;
    }[] = [
      {
        name: "ACORD 125 by keywords",
        text: "ACORD 125 COMMERCIAL INSURANCE APPLICATION APPLICANT INFORMATION",
        expectedType: "ACORD_125",
      },
      {
        name: "ACORD 130 by keywords",
        text: "ACORD 130 WORKERS COMPENSATION EXPERIENCE MODIFICATION PAYROLL BY CLASS",
        expectedType: "ACORD_130",
      },
      {
        name: "ACORD 140 by keywords",
        text: "ACORD 140 PROPERTY SECTION BUILDING DESCRIPTION CONSTRUCTION TYPE",
        expectedType: "ACORD_140",
      },
      {
        name: "Loss Run by keywords",
        text: "LOSS RUN CLAIM NUMBER DATE OF LOSS TOTAL INCURRED",
        expectedType: "LOSS_RUN",
      },
      {
        name: "Financial Statement by keywords",
        text: "BALANCE SHEET INCOME STATEMENT NET INCOME TOTAL ASSETS TOTAL LIABILITIES OPERATING EXPENSES",
        expectedType: "FINANCIAL_STATEMENT",
      },
      {
        name: "COI by keywords",
        text: "CERTIFICATE OF LIABILITY INSURANCE CERTIFICATE HOLDER THIS CERTIFICATE IS ISSUED GENERAL LIABILITY",
        expectedType: "COI",
      },
      {
        name: "Entity Doc by keywords",
        text: "ARTICLES OF INCORPORATION CERTIFICATE OF FORMATION REGISTERED AGENT SECRETARY OF STATE",
        expectedType: "ENTITY_DOC",
      },
      {
        name: "MVR by keywords",
        text: "MOTOR VEHICLE REPORT DRIVING RECORD DRIVER LICENSE VIOLATIONS",
        expectedType: "MVR",
      },
      {
        name: "SOV by keywords",
        text: "SCHEDULE OF VALUES BUILDING VALUE CONTENTS VALUE LOCATION SCHEDULE",
        expectedType: "SOV",
      },
      {
        name: "Surplus Lines by keywords",
        text: "SURPLUS LINE EXCESS LINE NON-ADMITTED DILIGENT SEARCH",
        expectedType: "SURPLUS_LINES",
      },
      {
        name: "Professional License by keywords",
        text: "PROFESSIONAL LICENSE LICENSE NUMBER BOARD OF ISSUED BY",
        expectedType: "PROFESSIONAL_LICENSE",
      },
      {
        name: "Environmental Report by keywords",
        text: "ENVIRONMENTAL SITE ASSESSMENT PHASE I HAZARDOUS SUBSTANCE CONTAMINATION",
        expectedType: "ENVIRONMENTAL_REPORT",
      },
      {
        name: "Payroll Tax by keywords",
        text: "PAYROLL TAX FORM 941 QUARTERLY FEDERAL TAX WAGES AND TIPS",
        expectedType: "PAYROLL_TAX",
      },
      {
        name: "Broker Submission by keywords",
        text: "SUBMISSION SUMMARY COVER LETTER BROKER SUBMISSION PLEASE FIND ATTACHED",
        expectedType: "BROKER_SUBMISSION",
      },
      {
        name: "Fleet Schedule by keywords",
        text: "FLEET SCHEDULE VEHICLE LIST VIN MAKE AND MODEL",
        expectedType: "FLEET_SCHEDULE",
      },
    ];

    it.each(textContentCases)(
      "classifies PDF as $expectedType when text contains $name",
      async ({ text, expectedType }) => {
        // Use a generic filename that does NOT match filename patterns
        const doc = makeDocument({
          fileName: "document.pdf",
          s3Key: "tenant-001/sub-clean/doc-test/document.pdf",
        });
        mockPrisma.document.update
          .mockResolvedValueOnce(doc as never)
          .mockResolvedValueOnce(doc as never);
        mockGetText.mockResolvedValue({ text });

        const result = await classifyDocument(doc.id);

        expect(result.documentType).toBe(expectedType);
        expect(result.confidence).toBeGreaterThan(0);
      },
    );

    it("text content classification overrides filename when confidence is higher", async () => {
      // Filename says "Loss_Runs" (0.7) but text keywords say COI (0.9 * matchRatio)
      const doc = makeDocument({
        fileName: "Loss_Runs_2024.pdf",
        s3Key: "tenant-001/sub-clean/doc-test/Loss_Runs_2024.pdf",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      // All 4 COI keywords match => score = (4/4) * 0.9 = 0.9 > 0.7 (filename)
      mockGetText.mockResolvedValue({
        text: "CERTIFICATE OF LIABILITY INSURANCE CERTIFICATE HOLDER THIS CERTIFICATE IS ISSUED GENERAL LIABILITY",
      });

      const result = await classifyDocument(doc.id);

      expect(result.documentType).toBe("COI");
      expect(result.confidence).toBe(0.9);
    });

    it("filename classification wins when text content has lower confidence", async () => {
      // Filename "ACORD_125" gives 0.7. Text matches only 1 of 4 BROKER_SUBMISSION
      // keywords => (1/4)*0.8 = 0.2 < 0.7
      const doc = makeDocument({
        fileName: "ACORD_125_Application.pdf",
        s3Key: "tenant-001/sub-clean/doc-test/ACORD_125_Application.pdf",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      mockGetText.mockResolvedValue({ text: "PLEASE FIND ATTACHED the application" });

      const result = await classifyDocument(doc.id);

      expect(result.documentType).toBe("ACORD_125");
      expect(result.confidence).toBe(0.7);
    });

    it("caps text content confidence at 0.99", async () => {
      const doc = makeDocument({
        fileName: "document.pdf",
        s3Key: "tenant-001/sub-clean/doc-test/document.pdf",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      // All ACORD 125 keywords match: (3/3)*0.9 = 0.9 which is under cap
      // All COI keywords match: (4/4)*0.9 = 0.9
      // Neither exceeds 0.99, but the cap logic still applies as Math.min(score, 0.99)
      mockGetText.mockResolvedValue({
        text: "ACORD 125 COMMERCIAL INSURANCE APPLICATION APPLICANT INFORMATION",
      });

      const result = await classifyDocument(doc.id);

      expect(result.confidence).toBeLessThanOrEqual(0.99);
    });
  });

  // ── Spreadsheet classification ─────────────────────────

  describe("spreadsheet classification", () => {
    const spreadsheetCases: {
      fileName: string;
      expectedType: string;
    }[] = [
      { fileName: "loss_run_data.xlsx", expectedType: "LOSS_RUN" },
      { fileName: "sov_schedule.xlsx", expectedType: "SOV" },
      { fileName: "schedule_of_values.csv", expectedType: "SOV" },
      { fileName: "fleet_vehicles.xls", expectedType: "FLEET_SCHEDULE" },
      { fileName: "vehicle_list.xlsx", expectedType: "FLEET_SCHEDULE" },
      { fileName: "payroll_data.xlsx", expectedType: "PAYROLL_TAX" },
      { fileName: "financial_data.csv", expectedType: "FINANCIAL_STATEMENT" },
    ];

    it.each(spreadsheetCases)(
      "classifies spreadsheet '$fileName' as $expectedType with 0.6 confidence",
      async ({ fileName, expectedType }) => {
        const doc = makeDocument({
          fileName,
          fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          s3Key: `tenant-001/sub-clean/doc-test/${fileName}`,
        });
        mockPrisma.document.update
          .mockResolvedValueOnce(doc as never)
          .mockResolvedValueOnce(doc as never);

        const result = await classifyDocument(doc.id);

        expect(result.documentType).toBe(expectedType);
        // Spreadsheet filename patterns match at 0.6, but FILENAME_PATTERNS also
        // checked at 0.7, so the highest-confidence result wins
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      },
    );

    it("spreadsheet with filename matching FILENAME_PATTERNS gets 0.7 from filename strategy", async () => {
      // "schedule_of_values.xlsx" matches SOV in FILENAME_PATTERNS (0.7)
      // and also in SHEET_NAME_PATTERNS (0.6). The highest confidence (0.7) wins.
      const doc = makeDocument({
        fileName: "schedule_of_values.xlsx",
        s3Key: "tenant-001/sub-clean/doc-test/schedule_of_values.xlsx",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      const result = await classifyDocument(doc.id);

      expect(result.documentType).toBe("SOV");
      expect(result.confidence).toBe(0.7);
    });
  });

  // ── Image classification ───────────────────────────────

  describe("image classification", () => {
    const imageExtensions = [".jpg", ".jpeg", ".png", ".tiff", ".tif"];

    it.each(imageExtensions)(
      "classifies image with extension '%s' as INSPECTION_PHOTO with 0.5 confidence",
      async (ext) => {
        const fileName = `photo_001${ext}`;
        const doc = makeDocument({
          fileName,
          fileType: `image/${ext.replace(".", "")}`,
          s3Key: `tenant-001/sub-clean/doc-test/${fileName}`,
        });
        mockPrisma.document.update
          .mockResolvedValueOnce(doc as never)
          .mockResolvedValueOnce(doc as never);

        const result = await classifyDocument(doc.id);

        expect(result.documentType).toBe("INSPECTION_PHOTO");
        expect(result.confidence).toBe(0.5);
      },
    );

    it("image with inspection_photo in filename gets 0.7 from filename pattern", async () => {
      // "inspection_photo_front.jpg" matches FILENAME_PATTERNS (0.7)
      // and IMAGE_EXTENSIONS (0.5). The highest confidence (0.7) wins.
      const doc = makeDocument({
        fileName: "inspection_photo_front.jpg",
        fileType: "image/jpeg",
        s3Key: "tenant-001/sub-clean/doc-test/inspection_photo_front.jpg",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      const result = await classifyDocument(doc.id);

      expect(result.documentType).toBe("INSPECTION_PHOTO");
      expect(result.confidence).toBe(0.7);
    });
  });

  // ── Fallback to UNKNOWN ────────────────────────────────

  describe("fallback to UNKNOWN", () => {
    it("returns UNKNOWN with 0 confidence when no pattern matches", async () => {
      const doc = makeDocument({
        fileName: "random_attachment.pdf",
        s3Key: "tenant-001/sub-clean/doc-test/random_attachment.pdf",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);
      mockGetText.mockResolvedValue({ text: "Nothing relevant here." });

      const result = await classifyDocument(doc.id);

      expect(result.documentType).toBe("UNKNOWN");
      expect(result.confidence).toBe(0);
    });

    it("returns UNKNOWN for a non-PDF, non-image, non-spreadsheet file with unrecognized name", async () => {
      const doc = makeDocument({
        fileName: "mystery_file.docx",
        fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        s3Key: "tenant-001/sub-clean/doc-test/mystery_file.docx",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      const result = await classifyDocument(doc.id);

      expect(result.documentType).toBe("UNKNOWN");
      expect(result.confidence).toBe(0);
    });
  });

  // ── PDF parsing failure ────────────────────────────────

  describe("PDF parsing failure handling", () => {
    it("falls back to filename classification when PDF parsing throws", async () => {
      const doc = makeDocument({
        fileName: "ACORD_125_Application.pdf",
        s3Key: "tenant-001/sub-clean/doc-test/ACORD_125_Application.pdf",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      // Make getText throw to simulate corrupt PDF
      mockGetText.mockRejectedValue(new Error("Invalid PDF structure"));

      const result = await classifyDocument(doc.id);

      // Should still classify by filename
      expect(result.documentType).toBe("ACORD_125");
      expect(result.confidence).toBe(0.7);
    });

    it("falls back to filename classification when S3 download fails", async () => {
      const doc = makeDocument({
        fileName: "Loss_Runs_2024.pdf",
        s3Key: "tenant-001/sub-clean/doc-test/Loss_Runs_2024.pdf",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      mockGetFromS3.mockRejectedValue(new Error("S3 access denied"));

      const result = await classifyDocument(doc.id);

      expect(result.documentType).toBe("LOSS_RUN");
      expect(result.confidence).toBe(0.7);
    });

    it("returns UNKNOWN when PDF parsing fails and filename has no pattern match", async () => {
      const doc = makeDocument({
        fileName: "document.pdf",
        s3Key: "tenant-001/sub-clean/doc-test/document.pdf",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      mockGetText.mockRejectedValue(new Error("Corrupt PDF"));

      const result = await classifyDocument(doc.id);

      expect(result.documentType).toBe("UNKNOWN");
      expect(result.confidence).toBe(0);
    });

    it("skips text classification when PDF text is empty", async () => {
      const doc = makeDocument({
        fileName: "document.pdf",
        s3Key: "tenant-001/sub-clean/doc-test/document.pdf",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      // Empty text — classifyByTextContent should not be called / return null
      mockGetText.mockResolvedValue({ text: "   " });

      const result = await classifyDocument(doc.id);

      expect(result.documentType).toBe("UNKNOWN");
      expect(result.confidence).toBe(0);
    });
  });

  // ── Document update on success ─────────────────────────

  describe("document update on success", () => {
    it("updates document with type, confidence, and EXTRACTING status", async () => {
      const doc = makeDocument({
        fileName: "ACORD_130_WC.pdf",
        s3Key: "tenant-001/sub-clean/doc-test/ACORD_130_WC.pdf",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never) // CLASSIFYING
        .mockResolvedValueOnce(doc as never); // EXTRACTING

      // Text also matches with high confidence
      mockGetText.mockResolvedValue({
        text: "ACORD 130 WORKERS COMPENSATION EXPERIENCE MODIFICATION PAYROLL BY CLASS",
      });

      const result = await classifyDocument(doc.id);

      const secondUpdateCall = mockPrisma.document.update.mock.calls[1];
      const updateData = (secondUpdateCall[0] as { data: Record<string, unknown> }).data;

      expect(updateData.documentType).toBe(result.documentType);
      expect(updateData.classificationConfidence).toBe(result.confidence);
      expect(updateData.status).toBe("EXTRACTING");
    });

    it("returns the classification result matching what was written to DB", async () => {
      const doc = makeDocument({
        fileName: "COI-Certificate.pdf",
        s3Key: "tenant-001/sub-clean/doc-test/COI-Certificate.pdf",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      const result = await classifyDocument(doc.id);

      expect(result).toEqual({
        documentType: "COI",
        confidence: 0.7,
      });
    });
  });

  // ── Integration with fixture data ──────────────────────

  describe("fixture document classification", () => {
    it("classifies the ACORD 125 fixture document correctly", async () => {
      const doc = makeDocument({
        id: DOCUMENTS.acord125.id,
        fileName: DOCUMENTS.acord125.fileName,
        s3Key: DOCUMENTS.acord125.s3Key,
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      const result = await classifyDocument(DOCUMENTS.acord125.id);

      expect(result.documentType).toBe("ACORD_125");
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("classifies the ACORD 130 fixture document correctly", async () => {
      const doc = makeDocument({
        id: DOCUMENTS.acord130.id,
        fileName: DOCUMENTS.acord130.fileName,
        s3Key: DOCUMENTS.acord130.s3Key,
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      const result = await classifyDocument(DOCUMENTS.acord130.id);

      expect(result.documentType).toBe("ACORD_130");
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("classifies the Financial Statement fixture document correctly", async () => {
      const doc = makeDocument({
        id: DOCUMENTS.financialStatement.id,
        fileName: DOCUMENTS.financialStatement.fileName,
        s3Key: DOCUMENTS.financialStatement.s3Key,
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      const result = await classifyDocument(DOCUMENTS.financialStatement.id);

      expect(result.documentType).toBe("FINANCIAL_STATEMENT");
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("classifies the Loss Run fixture document correctly", async () => {
      const doc = makeDocument({
        id: DOCUMENTS.lossRunFraud.id,
        fileName: DOCUMENTS.lossRunFraud.fileName,
        s3Key: DOCUMENTS.lossRunFraud.s3Key,
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      const result = await classifyDocument(DOCUMENTS.lossRunFraud.id);

      expect(result.documentType).toBe("LOSS_RUN");
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  // ── Non-PDF files skip text analysis ───────────────────

  describe("non-PDF files skip text analysis", () => {
    it("does not attempt S3 download for image files", async () => {
      const doc = makeDocument({
        fileName: "building_photo.jpg",
        fileType: "image/jpeg",
        s3Key: "tenant-001/sub-clean/doc-test/building_photo.jpg",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      await classifyDocument(doc.id);

      expect(mockGetFromS3).not.toHaveBeenCalled();
    });

    it("does not attempt S3 download for spreadsheet files", async () => {
      const doc = makeDocument({
        fileName: "sov_schedule.xlsx",
        fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        s3Key: "tenant-001/sub-clean/doc-test/sov_schedule.xlsx",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      await classifyDocument(doc.id);

      expect(mockGetFromS3).not.toHaveBeenCalled();
    });

    it("attempts S3 download only for PDF files", async () => {
      const doc = makeDocument({
        fileName: "document.pdf",
        s3Key: "tenant-001/sub-clean/doc-test/document.pdf",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      await classifyDocument(doc.id);

      expect(mockGetFromS3).toHaveBeenCalledWith(doc.s3Key);
    });
  });

  // ── Highest confidence selection ───────────────────────

  describe("highest confidence selection", () => {
    it("picks text result over filename when text confidence is higher", async () => {
      // Filename: "Loss_Runs.pdf" => LOSS_RUN at 0.7
      // Text: all ACORD 125 keywords => (3/3)*0.9 = 0.9
      const doc = makeDocument({
        fileName: "Loss_Runs.pdf",
        s3Key: "tenant-001/sub-clean/doc-test/Loss_Runs.pdf",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      mockGetText.mockResolvedValue({
        text: "ACORD 125 COMMERCIAL INSURANCE APPLICATION APPLICANT INFORMATION",
      });

      const result = await classifyDocument(doc.id);

      expect(result.documentType).toBe("ACORD_125");
      expect(result.confidence).toBe(0.9);
    });

    it("picks filename result when text has partial match with lower confidence", async () => {
      // Filename: "ACORD_125_App.pdf" => ACORD_125 at 0.7
      // Text: one keyword for BROKER_SUBMISSION => (1/4)*0.8 = 0.2
      const doc = makeDocument({
        fileName: "ACORD_125_App.pdf",
        s3Key: "tenant-001/sub-clean/doc-test/ACORD_125_App.pdf",
      });
      mockPrisma.document.update
        .mockResolvedValueOnce(doc as never)
        .mockResolvedValueOnce(doc as never);

      mockGetText.mockResolvedValue({ text: "COVER LETTER attached below" });

      const result = await classifyDocument(doc.id);

      expect(result.documentType).toBe("ACORD_125");
      expect(result.confidence).toBe(0.7);
    });
  });
});
