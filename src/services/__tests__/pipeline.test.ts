import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { processSubmission } from "@/services/pipeline";
import { TENANT, SUBMISSION, DOCUMENTS } from "@/test/fixtures";

const mockLog = (createLogger as ReturnType<typeof vi.fn>).mock.results[0]
  ?.value ?? createLogger("pipeline");

// ─── Mock all service dependencies ────────────────────────
import { classifyDocument } from "@/services/classification";
import { extractAcord125 } from "@/services/extraction-acord125";
import { extractAcord130 } from "@/services/extraction-acord130";
import { extractAcord140 } from "@/services/extraction-acord140";
import { extractLossRun } from "@/services/extraction-loss-run";
import { extractFinancialStatement } from "@/services/extraction-financial-statement";
import { extractCOI } from "@/services/extraction-coi";
import { extractEntityDocument } from "@/services/extraction-entity-doc";
import {
  validateRevenue,
  validatePayroll,
  validateEmployeeCount,
  validateLossHistory,
  validatePropertyValues,
} from "@/services/validation-cross-doc";
import { analyzePdfMetadata } from "@/services/forensics-pdf-metadata";
import { detectStatisticalAnomalies } from "@/services/detection-statistical";
import { detectTemporalAnomalies } from "@/services/detection-temporal";
import { analyzeFinancialRatios } from "@/services/analysis-financial-ratios";
import { calculateRiskScore } from "@/services/scoring-engine";
import { routeSubmission } from "@/services/routing-engine";
import { verifyEntity } from "@/services/verification-sos";
import {
  screenOFAC,
  verifyBrokerLicense,
} from "@/services/verification-ofac-broker";
import { validateEIN } from "@/services/verification-address-ein";
import {
  analyzeImage,
  analyzeSubmissionImages,
} from "@/services/forensics-image";
import {
  detectGenAIForgery,
  matchTemplate,
} from "@/services/detection-genai-forgery";
import { analyzeBrokerLetter } from "@/services/analysis-broker-letter-nlp";
import { validateFleetVINs } from "@/services/verification-vin";
import { verifyProfessionalLicense } from "@/services/verification-professional-license";
import { resolveEntities } from "@/services/resolution-entity";

vi.mock("@/services/classification", () => ({ classifyDocument: vi.fn() }));
vi.mock("@/services/extraction-acord125", () => ({ extractAcord125: vi.fn() }));
vi.mock("@/services/extraction-acord130", () => ({ extractAcord130: vi.fn() }));
vi.mock("@/services/extraction-acord140", () => ({ extractAcord140: vi.fn() }));
vi.mock("@/services/extraction-loss-run", () => ({ extractLossRun: vi.fn() }));
vi.mock("@/services/extraction-financial-statement", () => ({
  extractFinancialStatement: vi.fn(),
}));
vi.mock("@/services/extraction-coi", () => ({ extractCOI: vi.fn() }));
vi.mock("@/services/extraction-entity-doc", () => ({
  extractEntityDocument: vi.fn(),
}));
vi.mock("@/services/validation-cross-doc", () => ({
  validateRevenue: vi.fn(),
  validatePayroll: vi.fn(),
  validateEmployeeCount: vi.fn(),
  validateLossHistory: vi.fn(),
  validatePropertyValues: vi.fn(),
}));
vi.mock("@/services/forensics-pdf-metadata", () => ({
  analyzePdfMetadata: vi.fn(),
}));
vi.mock("@/services/detection-statistical", () => ({
  detectStatisticalAnomalies: vi.fn(),
}));
vi.mock("@/services/detection-temporal", () => ({
  detectTemporalAnomalies: vi.fn(),
}));
vi.mock("@/services/analysis-financial-ratios", () => ({
  analyzeFinancialRatios: vi.fn(),
}));
vi.mock("@/services/scoring-engine", () => ({ calculateRiskScore: vi.fn() }));
vi.mock("@/services/routing-engine", () => ({ routeSubmission: vi.fn() }));
vi.mock("@/services/verification-sos", () => ({ verifyEntity: vi.fn() }));
vi.mock("@/services/verification-ofac-broker", () => ({
  screenOFAC: vi.fn(),
  verifyBrokerLicense: vi.fn(),
}));
vi.mock("@/services/verification-address-ein", () => ({
  validateEIN: vi.fn(),
}));
vi.mock("@/services/forensics-image", () => ({
  analyzeImage: vi.fn(),
  analyzeSubmissionImages: vi.fn(),
}));
vi.mock("@/services/detection-genai-forgery", () => ({
  detectGenAIForgery: vi.fn(),
  matchTemplate: vi.fn(),
}));
vi.mock("@/services/analysis-broker-letter-nlp", () => ({
  analyzeBrokerLetter: vi.fn(),
}));
vi.mock("@/services/verification-vin", () => ({
  validateFleetVINs: vi.fn(),
}));
vi.mock("@/services/verification-professional-license", () => ({
  verifyProfessionalLicense: vi.fn(),
}));
vi.mock("@/services/resolution-entity", () => ({
  resolveEntities: vi.fn(),
}));

// ─── Typed mocks ──────────────────────────────────────────

const mockedPrisma = vi.mocked(prisma);
const mockedClassify = vi.mocked(classifyDocument);
const mockedExtractAcord125 = vi.mocked(extractAcord125);
const mockedExtractAcord130 = vi.mocked(extractAcord130);
const mockedExtractAcord140 = vi.mocked(extractAcord140);
const mockedExtractLossRun = vi.mocked(extractLossRun);
const mockedExtractFinancial = vi.mocked(extractFinancialStatement);
const mockedExtractCOI = vi.mocked(extractCOI);
const mockedExtractEntity = vi.mocked(extractEntityDocument);
const mockedValidateRevenue = vi.mocked(validateRevenue);
const mockedValidatePayroll = vi.mocked(validatePayroll);
const mockedValidateEmployeeCount = vi.mocked(validateEmployeeCount);
const mockedValidateLossHistory = vi.mocked(validateLossHistory);
const mockedValidatePropertyValues = vi.mocked(validatePropertyValues);
const mockedAnalyzePdf = vi.mocked(analyzePdfMetadata);
const mockedStatistical = vi.mocked(detectStatisticalAnomalies);
const mockedTemporal = vi.mocked(detectTemporalAnomalies);
const mockedFinancialRatios = vi.mocked(analyzeFinancialRatios);
const mockedRiskScore = vi.mocked(calculateRiskScore);
const mockedRoute = vi.mocked(routeSubmission);
const mockedVerifyEntity = vi.mocked(verifyEntity);
const mockedScreenOFAC = vi.mocked(screenOFAC);
const mockedVerifyBroker = vi.mocked(verifyBrokerLicense);
const mockedValidateEIN = vi.mocked(validateEIN);
const mockedAnalyzeImage = vi.mocked(analyzeImage);
const mockedAnalyzeSubmissionImages = vi.mocked(analyzeSubmissionImages);
const mockedDetectForgery = vi.mocked(detectGenAIForgery);
const mockedMatchTemplate = vi.mocked(matchTemplate);
const mockedBrokerLetter = vi.mocked(analyzeBrokerLetter);
const mockedFleetVINs = vi.mocked(validateFleetVINs);
const mockedProfLicense = vi.mocked(verifyProfessionalLicense);
const mockedResolveEntities = vi.mocked(resolveEntities);

// ─── Helpers ──────────────────────────────────────────────

/** Standard test documents covering a mix of types */
const STANDARD_DOCS = [
  DOCUMENTS.acord125,
  DOCUMENTS.acord130,
  DOCUMENTS.financialStatement,
];

/**
 * Extended documents that include inspection photos, fleet schedules,
 * and professional licenses to trigger conditional Phase 2 branches.
 */
const EXTENDED_DOCS = [
  DOCUMENTS.acord125,
  DOCUMENTS.acord130,
  DOCUMENTS.financialStatement,
  {
    id: "doc-inspection-1",
    submissionId: SUBMISSION.clean.id,
    tenantId: TENANT.id,
    fileName: "site_photo_1.jpg",
    fileType: "image/jpeg",
    fileSize: 3500000,
    s3Key: "tenant-001/sub-clean/doc-inspection-1/site_photo_1.jpg",
    documentType: "INSPECTION_PHOTO" as const,
    classificationConfidence: 0.97,
    extractedData: null,
    status: "ANALYZED" as const,
    createdAt: new Date("2025-06-01"),
  },
  {
    id: "doc-fleet-1",
    submissionId: SUBMISSION.clean.id,
    tenantId: TENANT.id,
    fileName: "fleet_schedule.xlsx",
    fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileSize: 150000,
    s3Key: "tenant-001/sub-clean/doc-fleet-1/fleet_schedule.xlsx",
    documentType: "FLEET_SCHEDULE" as const,
    classificationConfidence: 0.91,
    extractedData: null,
    status: "ANALYZED" as const,
    createdAt: new Date("2025-06-01"),
  },
  {
    id: "doc-prof-license",
    submissionId: SUBMISSION.clean.id,
    tenantId: TENANT.id,
    fileName: "contractor_license.pdf",
    fileType: "application/pdf",
    fileSize: 120000,
    s3Key: "tenant-001/sub-clean/doc-prof-license/contractor_license.pdf",
    documentType: "PROFESSIONAL_LICENSE" as const,
    classificationConfidence: 0.89,
    extractedData: null,
    status: "ANALYZED" as const,
    createdAt: new Date("2025-06-01"),
  },
];

/** Build a submission with included documents */
function makeSubmissionWithDocs(
  docs: typeof STANDARD_DOCS = STANDARD_DOCS,
  overrides: Record<string, unknown> = {}
) {
  return {
    ...SUBMISSION.clean,
    status: "UPLOADED" as const,
    documents: docs,
    ...overrides,
  };
}

/** Set up the default happy-path mocks. Each test can override as needed. */
function setupDefaultMocks(classifiedDocs: typeof STANDARD_DOCS = STANDARD_DOCS) {
  // Prisma: fetch submission
  mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
    makeSubmissionWithDocs(classifiedDocs) as any
  );
  // Prisma: update status
  mockedPrisma.submission.update.mockResolvedValue({} as any);
  // Prisma: create audit log
  mockedPrisma.auditLog.create.mockResolvedValue({} as any);
  // Prisma: re-fetch classified docs
  mockedPrisma.document.findMany.mockResolvedValue(classifiedDocs as any);

  // Classification
  mockedClassify.mockResolvedValue(undefined as any);

  // Extraction
  mockedExtractAcord125.mockResolvedValue(undefined as any);
  mockedExtractAcord130.mockResolvedValue(undefined as any);
  mockedExtractAcord140.mockResolvedValue(undefined as any);
  mockedExtractLossRun.mockResolvedValue(undefined as any);
  mockedExtractFinancial.mockResolvedValue(undefined as any);
  mockedExtractCOI.mockResolvedValue(undefined as any);
  mockedExtractEntity.mockResolvedValue(undefined as any);

  // Phase 1 detection
  mockedValidateRevenue.mockResolvedValue(undefined as any);
  mockedValidatePayroll.mockResolvedValue(undefined as any);
  mockedValidateEmployeeCount.mockResolvedValue(undefined as any);
  mockedValidateLossHistory.mockResolvedValue(undefined as any);
  mockedValidatePropertyValues.mockResolvedValue(undefined as any);
  mockedAnalyzePdf.mockResolvedValue(undefined as any);
  mockedStatistical.mockResolvedValue(undefined as any);
  mockedTemporal.mockResolvedValue(undefined as any);
  mockedFinancialRatios.mockResolvedValue(undefined as any);

  // Phase 2 detection
  mockedVerifyEntity.mockResolvedValue(undefined as any);
  mockedScreenOFAC.mockResolvedValue(undefined as any);
  mockedVerifyBroker.mockResolvedValue(undefined as any);
  mockedValidateEIN.mockResolvedValue(undefined as any);
  mockedAnalyzeImage.mockResolvedValue(undefined as any);
  mockedAnalyzeSubmissionImages.mockResolvedValue(undefined as any);
  mockedDetectForgery.mockResolvedValue(undefined as any);
  mockedMatchTemplate.mockResolvedValue(undefined as any);
  mockedBrokerLetter.mockResolvedValue(undefined as any);
  mockedFleetVINs.mockResolvedValue(undefined as any);
  mockedProfLicense.mockResolvedValue(undefined as any);
  mockedResolveEntities.mockResolvedValue(undefined as any);

  // Scoring & routing
  mockedRiskScore.mockResolvedValue(undefined as any);
  mockedRoute.mockResolvedValue(undefined as any);
}

// ─── Tests ────────────────────────────────────────────────

describe("pipeline: processSubmission", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  // ------------------------------------------------------------------
  // 1. Sets submission status to PROCESSING
  // ------------------------------------------------------------------
  describe("status management", () => {
    it("sets submission status to PROCESSING", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: SUBMISSION.clean.id },
        data: { status: "PROCESSING" },
      });
    });
  });

  // ------------------------------------------------------------------
  // 2. Creates PROCESSING_STARTED audit log
  // ------------------------------------------------------------------
  describe("audit logging", () => {
    it("creates PROCESSING_STARTED audit log", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      const startCall = mockedPrisma.auditLog.create.mock.calls[0]?.[0];
      expect(startCall).toBeDefined();
      expect(startCall!.data).toMatchObject({
        tenantId: TENANT.id,
        submissionId: SUBMISSION.clean.id,
        action: "PROCESSING_STARTED",
      });
      expect(startCall!.data.details).toMatchObject({
        documentCount: STANDARD_DOCS.length,
      });
    });

    // ------------------------------------------------------------------
    // 14. Creates PROCESSING_COMPLETED audit log with duration
    // ------------------------------------------------------------------
    it("creates PROCESSING_COMPLETED audit log with duration", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      const calls = mockedPrisma.auditLog.create.mock.calls;
      expect(calls.length).toBe(2);

      const completedCall = calls[1]?.[0];
      expect(completedCall).toBeDefined();
      expect(completedCall!.data).toMatchObject({
        tenantId: TENANT.id,
        submissionId: SUBMISSION.clean.id,
        action: "PROCESSING_COMPLETED",
      });
      const details = completedCall!.data.details as Record<string, unknown>;
      expect(details).toHaveProperty("durationMs");
      expect(typeof details.durationMs).toBe("number");
      expect(details.durationMs).toBeGreaterThanOrEqual(0);
      expect(details).toHaveProperty("completedAt");
      expect(details).toHaveProperty("documentsProcessed");
      expect(details.documentsProcessed).toBe(STANDARD_DOCS.length);
    });

    // ------------------------------------------------------------------
    // 17. Counts errors in completion audit log
    // ------------------------------------------------------------------
    it("counts errors in completion audit log when engines fail", async () => {
      setupDefaultMocks();

      // Make one classification and one Phase 1 engine fail
      mockedClassify.mockRejectedValueOnce(new Error("classify boom"));
      mockedValidateRevenue.mockRejectedValueOnce(
        new Error("revenue validation boom")
      );

      await processSubmission(SUBMISSION.clean.id);

      const calls = mockedPrisma.auditLog.create.mock.calls;
      const completedCall = calls[1]?.[0];
      const details = completedCall!.data.details as Record<string, unknown>;
      expect(details.classificationErrors).toBe(1);
      expect(details.phase1DetectionErrors).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // 3. Classifies all documents
  // ------------------------------------------------------------------
  describe("Step 1: Classification", () => {
    it("classifies all documents", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedClassify).toHaveBeenCalledTimes(STANDARD_DOCS.length);
      for (const doc of STANDARD_DOCS) {
        expect(mockedClassify).toHaveBeenCalledWith(doc.id);
      }
    });
  });

  // ------------------------------------------------------------------
  // 4. Re-fetches documents after classification
  // ------------------------------------------------------------------
  describe("post-classification refetch", () => {
    it("re-fetches documents after classification", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedPrisma.document.findMany).toHaveBeenCalledWith({
        where: { submissionId: SUBMISSION.clean.id },
      });
    });
  });

  // ------------------------------------------------------------------
  // 5. Extracts data from documents with known extractors
  // ------------------------------------------------------------------
  describe("Step 2: Extraction", () => {
    it("extracts data from documents with known extractors", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      // STANDARD_DOCS has ACORD_125, ACORD_130, FINANCIAL_STATEMENT
      expect(mockedExtractAcord125).toHaveBeenCalledWith(DOCUMENTS.acord125.id);
      expect(mockedExtractAcord130).toHaveBeenCalledWith(DOCUMENTS.acord130.id);
      expect(mockedExtractFinancial).toHaveBeenCalledWith(
        DOCUMENTS.financialStatement.id
      );
    });

    // ------------------------------------------------------------------
    // 6. Skips extraction for document types without extractors
    // ------------------------------------------------------------------
    it("skips extraction for document types without extractors", async () => {
      setupDefaultMocks(EXTENDED_DOCS);
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmissionWithDocs(EXTENDED_DOCS) as any
      );
      mockedPrisma.document.findMany.mockResolvedValue(EXTENDED_DOCS as any);

      await processSubmission(SUBMISSION.clean.id);

      // INSPECTION_PHOTO and FLEET_SCHEDULE have no extractors
      // Only ACORD_125, ACORD_130, FINANCIAL_STATEMENT should be called
      expect(mockedExtractAcord125).toHaveBeenCalledTimes(1);
      expect(mockedExtractAcord130).toHaveBeenCalledTimes(1);
      expect(mockedExtractFinancial).toHaveBeenCalledTimes(1);
      // No extraction calls for types without extractors
      expect(mockedExtractAcord140).not.toHaveBeenCalled();
      expect(mockedExtractLossRun).not.toHaveBeenCalled();
      expect(mockedExtractCOI).not.toHaveBeenCalled();
      expect(mockedExtractEntity).not.toHaveBeenCalled();
    });

    it("calls extractors for all mapped document types", async () => {
      const fullExtractionDocs = [
        { ...DOCUMENTS.acord125, id: "doc-a125", documentType: "ACORD_125" as const },
        { ...DOCUMENTS.acord130, id: "doc-a130", documentType: "ACORD_130" as const },
        {
          ...DOCUMENTS.acord125,
          id: "doc-a140",
          documentType: "ACORD_140" as const,
          fileName: "acord140.pdf",
        },
        {
          ...DOCUMENTS.acord125,
          id: "doc-lr",
          documentType: "LOSS_RUN" as const,
          fileName: "loss_run.pdf",
        },
        {
          ...DOCUMENTS.financialStatement,
          id: "doc-fs",
          documentType: "FINANCIAL_STATEMENT" as const,
        },
        {
          ...DOCUMENTS.acord125,
          id: "doc-coi",
          documentType: "COI" as const,
          fileName: "coi.pdf",
        },
        {
          ...DOCUMENTS.acord125,
          id: "doc-ent",
          documentType: "ENTITY_DOC" as const,
          fileName: "entity.pdf",
        },
      ];

      setupDefaultMocks(fullExtractionDocs as any);
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmissionWithDocs(fullExtractionDocs as any) as any
      );
      mockedPrisma.document.findMany.mockResolvedValue(fullExtractionDocs as any);

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedExtractAcord125).toHaveBeenCalledWith("doc-a125");
      expect(mockedExtractAcord130).toHaveBeenCalledWith("doc-a130");
      expect(mockedExtractAcord140).toHaveBeenCalledWith("doc-a140");
      expect(mockedExtractLossRun).toHaveBeenCalledWith("doc-lr");
      expect(mockedExtractFinancial).toHaveBeenCalledWith("doc-fs");
      expect(mockedExtractCOI).toHaveBeenCalledWith("doc-coi");
      expect(mockedExtractEntity).toHaveBeenCalledWith("doc-ent");
    });
  });

  // ------------------------------------------------------------------
  // 7. Runs Phase 1 detection engines
  // ------------------------------------------------------------------
  describe("Step 3: Phase 1 detection", () => {
    it("runs all 5 cross-document validations", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedValidateRevenue).toHaveBeenCalledWith(SUBMISSION.clean.id);
      expect(mockedValidatePayroll).toHaveBeenCalledWith(SUBMISSION.clean.id);
      expect(mockedValidateEmployeeCount).toHaveBeenCalledWith(
        SUBMISSION.clean.id
      );
      expect(mockedValidateLossHistory).toHaveBeenCalledWith(
        SUBMISSION.clean.id
      );
      expect(mockedValidatePropertyValues).toHaveBeenCalledWith(
        SUBMISSION.clean.id
      );
    });

    it("runs PDF forensics for each PDF document", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      // All 3 STANDARD_DOCS are PDFs
      const pdfDocs = STANDARD_DOCS.filter(
        (d) => d.fileType === "application/pdf"
      );
      expect(mockedAnalyzePdf).toHaveBeenCalledTimes(pdfDocs.length);
      for (const doc of pdfDocs) {
        expect(mockedAnalyzePdf).toHaveBeenCalledWith(doc.id);
      }
    });

    it("does not run PDF forensics for non-PDF documents", async () => {
      const docsWithNonPdf = [
        DOCUMENTS.acord125,
        {
          ...DOCUMENTS.acord130,
          id: "doc-image",
          fileType: "image/jpeg",
          documentType: "INSPECTION_PHOTO" as const,
        },
      ];
      setupDefaultMocks(docsWithNonPdf as any);
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmissionWithDocs(docsWithNonPdf as any) as any
      );
      mockedPrisma.document.findMany.mockResolvedValue(docsWithNonPdf as any);

      await processSubmission(SUBMISSION.clean.id);

      // Only 1 PDF (acord125), the image/jpeg should be skipped
      expect(mockedAnalyzePdf).toHaveBeenCalledTimes(1);
      expect(mockedAnalyzePdf).toHaveBeenCalledWith(DOCUMENTS.acord125.id);
    });

    it("runs statistical anomaly detection", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedStatistical).toHaveBeenCalledWith(SUBMISSION.clean.id);
    });

    it("runs temporal anomaly detection", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedTemporal).toHaveBeenCalledWith(SUBMISSION.clean.id);
    });

    it("runs financial ratio analysis", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedFinancialRatios).toHaveBeenCalledWith(SUBMISSION.clean.id);
    });
  });

  // ------------------------------------------------------------------
  // 8. Runs Phase 2 detection engines
  // ------------------------------------------------------------------
  describe("Step 4: Phase 2 detection", () => {
    it("runs entity verification engines", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedVerifyEntity).toHaveBeenCalledWith(SUBMISSION.clean.id);
      expect(mockedScreenOFAC).toHaveBeenCalledWith(SUBMISSION.clean.id);
      expect(mockedVerifyBroker).toHaveBeenCalledWith(SUBMISSION.clean.id);
      expect(mockedValidateEIN).toHaveBeenCalledWith(SUBMISSION.clean.id);
    });

    it("runs GenAI forgery detection on forgery-check doc types", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      // STANDARD_DOCS: ACORD_125, ACORD_130, FINANCIAL_STATEMENT
      // All three are in FORGERY_CHECK_DOC_TYPES
      expect(mockedDetectForgery).toHaveBeenCalledTimes(3);
      expect(mockedMatchTemplate).toHaveBeenCalledTimes(3);
      for (const doc of STANDARD_DOCS) {
        expect(mockedDetectForgery).toHaveBeenCalledWith(doc.id);
        expect(mockedMatchTemplate).toHaveBeenCalledWith(doc.id);
      }
    });

    it("runs broker letter NLP analysis", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedBrokerLetter).toHaveBeenCalledWith(SUBMISSION.clean.id);
    });

    it("runs entity resolution", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedResolveEntities).toHaveBeenCalledWith(SUBMISSION.clean.id);
    });

    // ------------------------------------------------------------------
    // 9. Runs image forensics only for INSPECTION_PHOTO docs
    // ------------------------------------------------------------------
    it("runs image forensics only for INSPECTION_PHOTO documents", async () => {
      setupDefaultMocks(EXTENDED_DOCS);
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmissionWithDocs(EXTENDED_DOCS) as any
      );
      mockedPrisma.document.findMany.mockResolvedValue(EXTENDED_DOCS as any);

      await processSubmission(SUBMISSION.clean.id);

      const inspectionDoc = EXTENDED_DOCS.find(
        (d) => d.documentType === "INSPECTION_PHOTO"
      )!;
      expect(mockedAnalyzeImage).toHaveBeenCalledTimes(1);
      expect(mockedAnalyzeImage).toHaveBeenCalledWith(inspectionDoc.id);
      expect(mockedAnalyzeSubmissionImages).toHaveBeenCalledWith(
        SUBMISSION.clean.id
      );
    });

    it("does not run image forensics when no INSPECTION_PHOTO docs exist", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedAnalyzeImage).not.toHaveBeenCalled();
      expect(mockedAnalyzeSubmissionImages).not.toHaveBeenCalled();
    });

    // ------------------------------------------------------------------
    // 10. Runs VIN validation only when FLEET_SCHEDULE docs exist
    // ------------------------------------------------------------------
    it("runs VIN validation only when FLEET_SCHEDULE docs exist", async () => {
      setupDefaultMocks(EXTENDED_DOCS);
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmissionWithDocs(EXTENDED_DOCS) as any
      );
      mockedPrisma.document.findMany.mockResolvedValue(EXTENDED_DOCS as any);

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedFleetVINs).toHaveBeenCalledWith(SUBMISSION.clean.id);
    });

    it("does not run VIN validation when no FLEET_SCHEDULE docs exist", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedFleetVINs).not.toHaveBeenCalled();
    });

    // ------------------------------------------------------------------
    // 11. Runs professional license verification only when PROFESSIONAL_LICENSE docs exist
    // ------------------------------------------------------------------
    it("runs professional license verification only when PROFESSIONAL_LICENSE docs exist", async () => {
      setupDefaultMocks(EXTENDED_DOCS);
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmissionWithDocs(EXTENDED_DOCS) as any
      );
      mockedPrisma.document.findMany.mockResolvedValue(EXTENDED_DOCS as any);

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedProfLicense).toHaveBeenCalledWith(SUBMISSION.clean.id);
    });

    it("does not run professional license verification when no PROFESSIONAL_LICENSE docs exist", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedProfLicense).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // 12. Calculates risk score after detection
  // ------------------------------------------------------------------
  describe("Step 5: Scoring", () => {
    it("calculates risk score after detection", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedRiskScore).toHaveBeenCalledWith(SUBMISSION.clean.id);
      expect(mockedRiskScore).toHaveBeenCalledTimes(1);
    });

    it("calls scoring after Phase 1 and Phase 2 engines", async () => {
      setupDefaultMocks();
      const callOrder: string[] = [];

      mockedValidateRevenue.mockImplementation(async () => {
        callOrder.push("phase1");
      });
      mockedResolveEntities.mockImplementation(async () => {
        callOrder.push("phase2");
      });
      mockedRiskScore.mockImplementation(async () => {
        callOrder.push("scoring");
      });
      mockedRoute.mockImplementation(async () => {
        callOrder.push("routing");
      });

      await processSubmission(SUBMISSION.clean.id);

      const scoringIdx = callOrder.indexOf("scoring");
      const phase1Idx = callOrder.indexOf("phase1");
      const phase2Idx = callOrder.indexOf("phase2");
      expect(scoringIdx).toBeGreaterThan(phase1Idx);
      expect(scoringIdx).toBeGreaterThan(phase2Idx);
    });
  });

  // ------------------------------------------------------------------
  // 13. Routes submission after scoring
  // ------------------------------------------------------------------
  describe("Step 6: Routing", () => {
    it("routes submission after scoring", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedRoute).toHaveBeenCalledWith(SUBMISSION.clean.id);
      expect(mockedRoute).toHaveBeenCalledTimes(1);
    });

    it("calls routing after scoring", async () => {
      setupDefaultMocks();
      const callOrder: string[] = [];

      mockedRiskScore.mockImplementation(async () => {
        callOrder.push("scoring");
      });
      mockedRoute.mockImplementation(async () => {
        callOrder.push("routing");
      });

      await processSubmission(SUBMISSION.clean.id);

      expect(callOrder.indexOf("routing")).toBeGreaterThan(
        callOrder.indexOf("scoring")
      );
    });
  });

  // ------------------------------------------------------------------
  // 15. Continues processing when individual engines fail (Promise.allSettled)
  // ------------------------------------------------------------------
  describe("fault tolerance (Promise.allSettled)", () => {
    it("continues processing when classification of one document fails", async () => {
      setupDefaultMocks();

      // First doc classify fails, others succeed
      mockedClassify
        .mockRejectedValueOnce(new Error("classify fail"))
        .mockResolvedValue(undefined as any);

      await processSubmission(SUBMISSION.clean.id);

      // Pipeline should still continue to extraction, detection, scoring, routing
      expect(mockedExtractAcord125).toHaveBeenCalled();
      expect(mockedValidateRevenue).toHaveBeenCalled();
      expect(mockedRiskScore).toHaveBeenCalled();
      expect(mockedRoute).toHaveBeenCalled();
    });

    it("continues processing when extraction fails for some documents", async () => {
      setupDefaultMocks();

      mockedExtractAcord125.mockRejectedValueOnce(
        new Error("extraction fail")
      );

      await processSubmission(SUBMISSION.clean.id);

      // Other extractors and subsequent steps still run
      expect(mockedExtractAcord130).toHaveBeenCalled();
      expect(mockedExtractFinancial).toHaveBeenCalled();
      expect(mockedValidateRevenue).toHaveBeenCalled();
      expect(mockedRiskScore).toHaveBeenCalled();
      expect(mockedRoute).toHaveBeenCalled();
    });

    it("continues processing when Phase 1 engines fail", async () => {
      setupDefaultMocks();

      mockedValidateRevenue.mockRejectedValueOnce(new Error("revenue fail"));
      mockedStatistical.mockRejectedValueOnce(new Error("statistical fail"));

      await processSubmission(SUBMISSION.clean.id);

      // Phase 2, scoring, and routing should still run
      expect(mockedVerifyEntity).toHaveBeenCalled();
      expect(mockedScreenOFAC).toHaveBeenCalled();
      expect(mockedRiskScore).toHaveBeenCalled();
      expect(mockedRoute).toHaveBeenCalled();
    });

    it("continues processing when Phase 2 engines fail", async () => {
      setupDefaultMocks();

      mockedVerifyEntity.mockRejectedValueOnce(new Error("entity verify fail"));
      mockedScreenOFAC.mockRejectedValueOnce(new Error("ofac fail"));

      await processSubmission(SUBMISSION.clean.id);

      // Scoring and routing still run
      expect(mockedRiskScore).toHaveBeenCalled();
      expect(mockedRoute).toHaveBeenCalled();
    });

    it("continues when all Phase 1 engines fail", async () => {
      setupDefaultMocks();

      mockedValidateRevenue.mockRejectedValueOnce(new Error("fail"));
      mockedValidatePayroll.mockRejectedValueOnce(new Error("fail"));
      mockedValidateEmployeeCount.mockRejectedValueOnce(new Error("fail"));
      mockedValidateLossHistory.mockRejectedValueOnce(new Error("fail"));
      mockedValidatePropertyValues.mockRejectedValueOnce(new Error("fail"));
      mockedAnalyzePdf.mockRejectedValue(new Error("fail"));
      mockedStatistical.mockRejectedValueOnce(new Error("fail"));
      mockedTemporal.mockRejectedValueOnce(new Error("fail"));
      mockedFinancialRatios.mockRejectedValueOnce(new Error("fail"));

      await processSubmission(SUBMISSION.clean.id);

      expect(mockedVerifyEntity).toHaveBeenCalled();
      expect(mockedRiskScore).toHaveBeenCalled();
      expect(mockedRoute).toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // 16. Logs errors from failed engines
  // ------------------------------------------------------------------
  describe("error logging", () => {
    it("logs errors from failed classification steps", async () => {
      setupDefaultMocks();
      const error = new Error("classify boom");
      mockedClassify.mockRejectedValueOnce(error);

      await processSubmission(SUBMISSION.clean.id);

      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: error, stepName: "Classification" }),
        "pipeline step error"
      );
    });

    it("logs errors from failed extraction steps", async () => {
      setupDefaultMocks();
      const error = new Error("extraction boom");
      mockedExtractAcord125.mockRejectedValueOnce(error);

      await processSubmission(SUBMISSION.clean.id);

      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: error, stepName: "Extraction" }),
        "pipeline step error"
      );
    });

    it("logs errors from failed Phase 1 detection engines", async () => {
      setupDefaultMocks();
      const error = new Error("phase1 boom");
      mockedValidateRevenue.mockRejectedValueOnce(error);

      await processSubmission(SUBMISSION.clean.id);

      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: error, stepName: "Phase 1 Detection" }),
        "pipeline step error"
      );
    });

    it("logs errors from failed Phase 2 detection engines", async () => {
      setupDefaultMocks();
      const error = new Error("phase2 boom");
      mockedVerifyEntity.mockRejectedValueOnce(error);

      await processSubmission(SUBMISSION.clean.id);

      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: error, stepName: "Phase 2 Detection" }),
        "pipeline step error"
      );
    });

    it("logs multiple errors from multiple failed engines", async () => {
      setupDefaultMocks();
      const error1 = new Error("fail 1");
      const error2 = new Error("fail 2");
      mockedValidateRevenue.mockRejectedValueOnce(error1);
      mockedStatistical.mockRejectedValueOnce(error2);

      await processSubmission(SUBMISSION.clean.id);

      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: error1, stepName: "Phase 1 Detection" }),
        "pipeline step error"
      );
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: error2, stepName: "Phase 1 Detection" }),
        "pipeline step error"
      );
    });
  });

  // ------------------------------------------------------------------
  // Error count tracking in completion log
  // ------------------------------------------------------------------
  describe("error counts in completion audit log", () => {
    it("records zero errors when all engines succeed", async () => {
      setupDefaultMocks();

      await processSubmission(SUBMISSION.clean.id);

      const calls = mockedPrisma.auditLog.create.mock.calls;
      const completedCall = calls[1]?.[0];
      const details = completedCall!.data.details as Record<string, unknown>;
      expect(details.classificationErrors).toBe(0);
      expect(details.extractionErrors).toBe(0);
      expect(details.phase1DetectionErrors).toBe(0);
      expect(details.phase2DetectionErrors).toBe(0);
    });

    it("records extraction errors correctly", async () => {
      setupDefaultMocks();
      mockedExtractAcord125.mockRejectedValueOnce(new Error("fail"));
      mockedExtractAcord130.mockRejectedValueOnce(new Error("fail"));

      await processSubmission(SUBMISSION.clean.id);

      const calls = mockedPrisma.auditLog.create.mock.calls;
      const completedCall = calls[1]?.[0];
      const details = completedCall!.data.details as Record<string, unknown>;
      expect(details.extractionErrors).toBe(2);
    });

    it("records Phase 2 detection errors correctly", async () => {
      setupDefaultMocks();
      mockedVerifyEntity.mockRejectedValueOnce(new Error("fail"));
      mockedScreenOFAC.mockRejectedValueOnce(new Error("fail"));
      mockedDetectForgery.mockRejectedValue(new Error("fail"));

      await processSubmission(SUBMISSION.clean.id);

      const calls = mockedPrisma.auditLog.create.mock.calls;
      const completedCall = calls[1]?.[0];
      const details = completedCall!.data.details as Record<string, unknown>;
      // 2 from verifyEntity + screenOFAC + 3 from detectGenAIForgery (one per STANDARD_DOC)
      expect(details.phase2DetectionErrors).toBe(5);
    });
  });

  // ------------------------------------------------------------------
  // Full pipeline integration
  // ------------------------------------------------------------------
  describe("full pipeline order", () => {
    it("executes all steps in correct sequence", async () => {
      setupDefaultMocks();
      const callOrder: string[] = [];

      mockedPrisma.submission.update.mockImplementation(async () => {
        callOrder.push("status_update");
        return {} as any;
      });
      mockedClassify.mockImplementation(async () => {
        callOrder.push("classify");
      });
      mockedPrisma.document.findMany.mockImplementation(async () => {
        callOrder.push("refetch_docs");
        return STANDARD_DOCS as any;
      });
      mockedExtractAcord125.mockImplementation(async () => {
        callOrder.push("extract");
      });
      mockedValidateRevenue.mockImplementation(async () => {
        callOrder.push("phase1");
      });
      mockedVerifyEntity.mockImplementation(async () => {
        callOrder.push("phase2");
      });
      mockedRiskScore.mockImplementation(async () => {
        callOrder.push("scoring");
      });
      mockedRoute.mockImplementation(async () => {
        callOrder.push("routing");
      });

      await processSubmission(SUBMISSION.clean.id);

      // Verify sequential ordering of pipeline stages
      const statusIdx = callOrder.indexOf("status_update");
      const classifyIdx = callOrder.indexOf("classify");
      const refetchIdx = callOrder.indexOf("refetch_docs");
      const extractIdx = callOrder.indexOf("extract");
      const phase1Idx = callOrder.indexOf("phase1");
      const phase2Idx = callOrder.indexOf("phase2");
      const scoringIdx = callOrder.indexOf("scoring");
      const routingIdx = callOrder.indexOf("routing");

      expect(statusIdx).toBeLessThan(classifyIdx);
      expect(classifyIdx).toBeLessThan(refetchIdx);
      expect(refetchIdx).toBeLessThan(extractIdx);
      expect(extractIdx).toBeLessThan(phase1Idx);
      expect(phase1Idx).toBeLessThan(phase2Idx);
      expect(phase2Idx).toBeLessThan(scoringIdx);
      expect(scoringIdx).toBeLessThan(routingIdx);
    });
  });

  // ------------------------------------------------------------------
  // Edge cases
  // ------------------------------------------------------------------
  describe("edge cases", () => {
    it("handles submission with zero documents", async () => {
      setupDefaultMocks([]);
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmissionWithDocs([]) as any
      );
      mockedPrisma.document.findMany.mockResolvedValue([] as any);

      await processSubmission(SUBMISSION.clean.id);

      // Classification and extraction should not be called
      expect(mockedClassify).not.toHaveBeenCalled();
      expect(mockedExtractAcord125).not.toHaveBeenCalled();

      // Phase 1: cross-doc validations still run (submission level)
      expect(mockedValidateRevenue).toHaveBeenCalled();
      // No PDF docs so no PDF forensics
      expect(mockedAnalyzePdf).not.toHaveBeenCalled();

      // Phase 2: entity-level engines still run (submission level)
      expect(mockedVerifyEntity).toHaveBeenCalled();
      // No inspection photos
      expect(mockedAnalyzeImage).not.toHaveBeenCalled();

      // Scoring and routing still run
      expect(mockedRiskScore).toHaveBeenCalled();
      expect(mockedRoute).toHaveBeenCalled();
    });

    it("handles multiple INSPECTION_PHOTO documents", async () => {
      const docsWithMultiplePhotos = [
        ...STANDARD_DOCS,
        {
          id: "doc-photo-1",
          submissionId: SUBMISSION.clean.id,
          tenantId: TENANT.id,
          fileName: "photo1.jpg",
          fileType: "image/jpeg",
          fileSize: 2000000,
          s3Key: "s3/photo1.jpg",
          documentType: "INSPECTION_PHOTO" as const,
          classificationConfidence: 0.95,
          extractedData: null,
          status: "ANALYZED" as const,
          createdAt: new Date("2025-06-01"),
        },
        {
          id: "doc-photo-2",
          submissionId: SUBMISSION.clean.id,
          tenantId: TENANT.id,
          fileName: "photo2.jpg",
          fileType: "image/jpeg",
          fileSize: 2500000,
          s3Key: "s3/photo2.jpg",
          documentType: "INSPECTION_PHOTO" as const,
          classificationConfidence: 0.93,
          extractedData: null,
          status: "ANALYZED" as const,
          createdAt: new Date("2025-06-01"),
        },
      ];

      setupDefaultMocks(docsWithMultiplePhotos as any);
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmissionWithDocs(docsWithMultiplePhotos as any) as any
      );
      mockedPrisma.document.findMany.mockResolvedValue(
        docsWithMultiplePhotos as any
      );

      await processSubmission(SUBMISSION.clean.id);

      // analyzeImage called for each photo
      expect(mockedAnalyzeImage).toHaveBeenCalledTimes(2);
      expect(mockedAnalyzeImage).toHaveBeenCalledWith("doc-photo-1");
      expect(mockedAnalyzeImage).toHaveBeenCalledWith("doc-photo-2");
      // analyzeSubmissionImages called once
      expect(mockedAnalyzeSubmissionImages).toHaveBeenCalledTimes(1);
      expect(mockedAnalyzeSubmissionImages).toHaveBeenCalledWith(
        SUBMISSION.clean.id
      );
    });

    it("does not include forgery checks for INSPECTION_PHOTO or FLEET_SCHEDULE", async () => {
      setupDefaultMocks(EXTENDED_DOCS);
      mockedPrisma.submission.findUniqueOrThrow.mockResolvedValue(
        makeSubmissionWithDocs(EXTENDED_DOCS) as any
      );
      mockedPrisma.document.findMany.mockResolvedValue(EXTENDED_DOCS as any);

      await processSubmission(SUBMISSION.clean.id);

      // EXTENDED_DOCS: ACORD_125, ACORD_130, FINANCIAL_STATEMENT, INSPECTION_PHOTO, FLEET_SCHEDULE, PROFESSIONAL_LICENSE
      // Forgery-eligible: ACORD_125, ACORD_130, FINANCIAL_STATEMENT, PROFESSIONAL_LICENSE = 4
      expect(mockedDetectForgery).toHaveBeenCalledTimes(4);
      expect(mockedMatchTemplate).toHaveBeenCalledTimes(4);

      // Verify INSPECTION_PHOTO and FLEET_SCHEDULE were NOT sent to forgery detection
      const forgeryCallArgs = mockedDetectForgery.mock.calls.map((c) => c[0]);
      expect(forgeryCallArgs).not.toContain("doc-inspection-1");
      expect(forgeryCallArgs).not.toContain("doc-fleet-1");
    });
  });
});
