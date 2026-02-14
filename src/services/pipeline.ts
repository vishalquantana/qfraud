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

/**
 * Orchestrates the full submission processing pipeline:
 * 1. Classify all documents
 * 2. Extract data from classified documents
 * 3. Run Phase 1 detection engines
 * 4. Calculate risk score
 * 5. Route submission based on thresholds
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
  const detectionResults = await Promise.allSettled([
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

  logStepErrors("Detection", detectionResults);

  // Step 4: Calculate risk score
  await calculateRiskScore(submissionId);

  // Step 5: Route submission based on thresholds
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
          detectionErrors: countErrors(detectionResults),
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
