import { prisma } from "@/lib/prisma";
import type { DocumentType } from "@/generated/prisma/client";
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
// Phase 2 detection engines
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

/** Map document types to their extraction functions */
const EXTRACTORS: Partial<
  Record<DocumentType, (documentId: string) => Promise<unknown>>
> = {
  ACORD_125: extractAcord125,
  ACORD_130: extractAcord130,
  ACORD_140: extractAcord140,
  LOSS_RUN: extractLossRun,
  FINANCIAL_STATEMENT: extractFinancialStatement,
  COI: extractCOI,
  ENTITY_DOC: extractEntityDocument,
};

/** Document types relevant for image forensics */
const IMAGE_DOC_TYPES: DocumentType[] = ["INSPECTION_PHOTO"];

/** Document types relevant for GenAI forgery detection and template matching */
const FORGERY_CHECK_DOC_TYPES: DocumentType[] = [
  "ACORD_125",
  "ACORD_130",
  "ACORD_140",
  "LOSS_RUN",
  "FINANCIAL_STATEMENT",
  "COI",
  "ENTITY_DOC",
  "PROFESSIONAL_LICENSE",
  "ENVIRONMENTAL_REPORT",
  "SURPLUS_LINES",
];

/** Document types relevant for VIN validation */
const FLEET_DOC_TYPES: DocumentType[] = ["FLEET_SCHEDULE"];

/**
 * Orchestrates the full submission processing pipeline:
 * 1. Classify all documents
 * 2. Extract data from classified documents
 * 3. Run Phase 1 detection engines
 * 4. Run Phase 2 detection engines
 * 5. Calculate risk score (includes Phase 1 + Phase 2 indicators)
 * 6. Route submission based on thresholds
 */
export async function processSubmission(submissionId: string): Promise<void> {
  const startTime = Date.now();

  // Fetch submission and its documents
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { documents: true },
  });

  // Set status to PROCESSING
  await prisma.submission.update({
    where: { id: submissionId },
    data: { status: "PROCESSING" },
  });

  // Create audit log for pipeline start
  await prisma.auditLog.create({
    data: {
      tenantId: submission.tenantId,
      submissionId,
      action: "PROCESSING_STARTED",
      details: JSON.parse(
        JSON.stringify({
          documentCount: submission.documents.length,
          startedAt: new Date().toISOString(),
        })
      ),
    },
  });

  // Step 1: Classify all documents
  const classificationResults = await Promise.allSettled(
    submission.documents.map((doc) => classifyDocument(doc.id))
  );

  logStepErrors("Classification", classificationResults);

  // Re-fetch documents after classification to get updated documentType
  const classifiedDocs = await prisma.document.findMany({
    where: { submissionId },
  });

  // Step 2: Extract data from all classified documents
  const extractionResults = await Promise.allSettled(
    classifiedDocs.map((doc) => {
      const extractor = EXTRACTORS[doc.documentType];
      if (!extractor) return Promise.resolve(); // No extractor for this type
      return extractor(doc.id);
    })
  );

  logStepErrors("Extraction", extractionResults);

  // Step 3: Run all Phase 1 detection engines in parallel
  const phase1Results = await Promise.allSettled([
    // Cross-document validations
    validateRevenue(submissionId),
    validatePayroll(submissionId),
    validateEmployeeCount(submissionId),
    validateLossHistory(submissionId),
    validatePropertyValues(submissionId),
    // PDF forensics for each document
    ...classifiedDocs
      .filter((doc) => doc.fileType === "application/pdf")
      .map((doc) => analyzePdfMetadata(doc.id)),
    // Statistical anomaly detection
    detectStatisticalAnomalies(submissionId),
    // Temporal anomaly detection
    detectTemporalAnomalies(submissionId),
    // Financial ratio analysis
    analyzeFinancialRatios(submissionId),
  ]);

  logStepErrors("Phase 1 Detection", phase1Results);

  // Step 4: Run Phase 2 detection engines in parallel
  // Phase 2 engines run only on relevant document types
  const inspectionPhotos = classifiedDocs.filter((doc) =>
    IMAGE_DOC_TYPES.includes(doc.documentType)
  );
  const forgeryCheckDocs = classifiedDocs.filter((doc) =>
    FORGERY_CHECK_DOC_TYPES.includes(doc.documentType)
  );
  const hasFleetDocs = classifiedDocs.some((doc) =>
    FLEET_DOC_TYPES.includes(doc.documentType)
  );
  const hasProfLicenseDocs = classifiedDocs.some(
    (doc) => doc.documentType === "PROFESSIONAL_LICENSE"
  );

  const phase2Results = await Promise.allSettled([
    // Entity verification: SOS, OFAC, broker license, address/EIN
    verifyEntity(submissionId),
    screenOFAC(submissionId),
    verifyBrokerLicense(submissionId),
    validateEIN(submissionId),
    // Image forensics: per-image analysis + cross-photo timestamps
    ...inspectionPhotos.map((doc) => analyzeImage(doc.id)),
    ...(inspectionPhotos.length > 0
      ? [analyzeSubmissionImages(submissionId)]
      : []),
    // GenAI forgery detection and template matching on relevant docs
    ...forgeryCheckDocs.map((doc) => detectGenAIForgery(doc.id)),
    ...forgeryCheckDocs.map((doc) => matchTemplate(doc.id)),
    // Broker cover letter NLP analysis
    analyzeBrokerLetter(submissionId),
    // VIN validation (only if fleet schedule docs exist)
    ...(hasFleetDocs ? [validateFleetVINs(submissionId)] : []),
    // Professional license verification (only if license docs exist)
    ...(hasProfLicenseDocs ? [verifyProfessionalLicense(submissionId)] : []),
    // Cross-submission entity resolution
    resolveEntities(submissionId),
  ]);

  logStepErrors("Phase 2 Detection", phase2Results);

  // Step 5: Calculate risk score (includes all Phase 1 + Phase 2 indicators)
  await calculateRiskScore(submissionId);

  // Step 6: Route submission based on thresholds
  await routeSubmission(submissionId);

  // Create audit log for pipeline completion
  const durationMs = Date.now() - startTime;
  await prisma.auditLog.create({
    data: {
      tenantId: submission.tenantId,
      submissionId,
      action: "PROCESSING_COMPLETED",
      details: JSON.parse(
        JSON.stringify({
          durationMs,
          completedAt: new Date().toISOString(),
          documentsProcessed: classifiedDocs.length,
          classificationErrors: countErrors(classificationResults),
          extractionErrors: countErrors(extractionResults),
          phase1DetectionErrors: countErrors(phase1Results),
          phase2DetectionErrors: countErrors(phase2Results),
        })
      ),
    },
  });
}

/** Log errors from Promise.allSettled results without stopping the pipeline */
function logStepErrors(
  stepName: string,
  results: PromiseSettledResult<unknown>[]
) {
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`[Pipeline] ${stepName} error:`, result.reason);
    }
  }
}

/** Count rejected promises from allSettled results */
function countErrors(results: PromiseSettledResult<unknown>[]): number {
  return results.filter((r) => r.status === "rejected").length;
}
