import { prisma } from "@/lib/prisma";
import { getFromS3 } from "@/lib/s3";
import type { DocumentType } from "@/generated/prisma/client";

// ─── Types ──────────────────────────────────────────────

/** Interface for future ML model integration */
export interface ForgeryDetectionResult {
  isLikelyForged: boolean;
  confidence: number;
  indicators: string[];
}

/** Structural feature expectations for template matching */
interface TemplateFeatures {
  pageCountMin: number;
  pageCountMax: number;
  expectedKeywords: RegExp[];
  logoPresenceExpected: boolean;
  description: string;
}

// ─── Template Library ───────────────────────────────────

/**
 * Template library mapping document types to expected structural features.
 * Used by matchTemplate to detect documents that don't conform to
 * expected formats for their claimed type.
 */
const TEMPLATE_LIBRARY: Partial<Record<DocumentType, TemplateFeatures>> = {
  ACORD_125: {
    pageCountMin: 2,
    pageCountMax: 12,
    expectedKeywords: [
      /ACORD/i,
      /COMMERCIAL\s+INSURANCE/i,
      /APPLICANT/i,
      /AGENCY/i,
    ],
    logoPresenceExpected: true,
    description: "ACORD 125 Commercial Insurance Application",
  },
  ACORD_130: {
    pageCountMin: 1,
    pageCountMax: 8,
    expectedKeywords: [
      /ACORD/i,
      /WORKERS\s*COMP/i,
      /PAYROLL/i,
      /CLASS\s*CODE/i,
    ],
    logoPresenceExpected: true,
    description: "ACORD 130 Workers Compensation Application",
  },
  ACORD_140: {
    pageCountMin: 1,
    pageCountMax: 10,
    expectedKeywords: [
      /ACORD/i,
      /PROPERTY/i,
      /BUILDING/i,
      /CONSTRUCTION/i,
    ],
    logoPresenceExpected: true,
    description: "ACORD 140 Property Section",
  },
  LOSS_RUN: {
    pageCountMin: 1,
    pageCountMax: 50,
    expectedKeywords: [/LOSS/i, /CLAIM/i, /POLICY/i],
    logoPresenceExpected: false,
    description: "Loss Run Report",
  },
  COI: {
    pageCountMin: 1,
    pageCountMax: 4,
    expectedKeywords: [
      /CERTIFICATE/i,
      /INSURANCE/i,
      /HOLDER/i,
      /LIABILITY/i,
    ],
    logoPresenceExpected: true,
    description: "Certificate of Insurance",
  },
  FINANCIAL_STATEMENT: {
    pageCountMin: 1,
    pageCountMax: 30,
    expectedKeywords: [/ASSETS/i, /LIABILITIES/i, /REVENUE|INCOME/i],
    logoPresenceExpected: false,
    description: "Financial Statement",
  },
  ENTITY_DOC: {
    pageCountMin: 1,
    pageCountMax: 10,
    expectedKeywords: [
      /CERTIFICATE|ARTICLES/i,
      /STATE|SECRETARY/i,
      /INCORPORATION|FORMATION/i,
    ],
    logoPresenceExpected: false,
    description: "Business Entity Document",
  },
  SURPLUS_LINES: {
    pageCountMin: 1,
    pageCountMax: 5,
    expectedKeywords: [/SURPLUS/i, /EXCESS|NON.?ADMITTED/i, /DILIGENT/i],
    logoPresenceExpected: false,
    description: "Surplus Lines Document",
  },
  PROFESSIONAL_LICENSE: {
    pageCountMin: 1,
    pageCountMax: 3,
    expectedKeywords: [/LICENSE/i, /BOARD|ISSUED|STATE/i],
    logoPresenceExpected: true,
    description: "Professional License",
  },
};

// ─── GenAI Forgery Detection ────────────────────────────

/**
 * Detect AI-generated or forged documents.
 *
 * This is a stub service that returns a forgery probability score.
 * The interface is designed for future ML model integration where the
 * model would analyze document bytes for:
 * - Synthetic text patterns (AI-generated text inconsistencies)
 * - Font rendering anomalies (digital forgery artifacts)
 * - Layout inconsistencies (misaligned fields, unusual spacing)
 * - Metadata inconsistencies (creation tool vs content mismatch)
 *
 * Input: document bytes
 * Output: { isLikelyForged, confidence, indicators }
 *
 * Creates FraudIndicator with category VISUAL_AI if forgery detected.
 */
export async function detectGenAIForgery(
  documentId: string,
): Promise<ForgeryDetectionResult> {
  const document = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { submission: true },
  });

  // Download the document from S3
  const buffer = await getFromS3(document.s3Key);

  // Run the stub detection model
  const result = analyzeForForgery(buffer, document.fileName);

  // Flag if high confidence forgery detected
  if (result.isLikelyForged && result.confidence > 0.7) {
    await prisma.fraudIndicator.create({
      data: {
        submissionId: document.submissionId,
        tenantId: document.tenantId,
        documentId: document.id,
        category: "VISUAL_AI",
        indicatorName: "GENAI_FORGERY_DETECTED",
        description: `Document "${document.fileName}" has been flagged as potentially AI-generated or digitally forged with ${Math.round(result.confidence * 100)}% confidence. Indicators: ${result.indicators.join(", ")}.`,
        severity: "CRITICAL",
        evidence: JSON.parse(
          JSON.stringify({
            confidence: result.confidence,
            indicators: result.indicators,
            documentId: document.id,
            fileName: document.fileName,
            documentType: document.documentType,
          }),
        ),
        confidence: result.confidence,
        recommendedAction:
          "Request original documents directly from the issuing authority. Verify document authenticity through independent channels. Consider referring to SIU for investigation.",
      },
    });
  }

  return result;
}

/**
 * Stub forgery analysis function.
 * In production, this would invoke an ML model (e.g., a fine-tuned vision transformer)
 * that analyzes document images/content for synthetic generation artifacts.
 *
 * Returns low-confidence negative result — ready for ML model swap-in.
 */
function analyzeForForgery(
  _buffer: Buffer,
  _fileName: string,
): ForgeryDetectionResult {
  // Stub implementation: always returns no forgery detected with very low confidence.
  // Real implementation would:
  // 1. Convert document to image(s) if PDF
  // 2. Run through a trained classifier (e.g., detecting GAN/diffusion artifacts)
  // 3. Analyze text for AI-generation patterns (perplexity analysis, etc.)
  // 4. Check font rendering consistency
  // 5. Detect copy-paste artifacts across document sections
  return {
    isLikelyForged: false,
    confidence: 0.1,
    indicators: [],
  };
}

// ─── Template Matching ──────────────────────────────────

/**
 * Compare a document's layout and structure against known templates
 * for the document type. Flags documents that don't match expected
 * structural features (page count, keywords, format).
 *
 * Creates FraudIndicator with category VISUAL_AI if template mismatch found.
 */
export async function matchTemplate(documentId: string): Promise<void> {
  const document = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { submission: true },
  });

  // Only match against templates we have defined
  const template = TEMPLATE_LIBRARY[document.documentType];
  if (!template) return; // No template for this document type

  // Only analyze PDFs for template matching (we need text and page count)
  const isPdf =
    document.fileType === "application/pdf" ||
    document.fileName.toLowerCase().endsWith(".pdf");
  if (!isPdf) return;

  // Download and parse the PDF
  let text = "";
  let pageCount = 0;

  try {
    const buffer = await getFromS3(document.s3Key);
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });

    const textResult = await parser.getText();
    text = textResult.text;

    const info = await parser.getInfo();
    pageCount = info.total;

    await parser.destroy();
  } catch {
    // PDF parsing failed — can't do template matching
    return;
  }

  const mismatches: string[] = [];

  // Check 1: Page count range
  if (pageCount < template.pageCountMin || pageCount > template.pageCountMax) {
    mismatches.push(
      `Page count (${pageCount}) outside expected range (${template.pageCountMin}-${template.pageCountMax})`,
    );
  }

  // Check 2: Expected keywords presence
  const keywordMatchCount = template.expectedKeywords.filter((kw) =>
    kw.test(text),
  ).length;
  const keywordMatchRatio = keywordMatchCount / template.expectedKeywords.length;

  if (keywordMatchRatio < 0.5) {
    mismatches.push(
      `Only ${keywordMatchCount}/${template.expectedKeywords.length} expected keywords found for ${template.description}`,
    );
  }

  // Check 3: ACORD-specific format check (ACORD forms should have "ACORD" in text)
  if (
    template.logoPresenceExpected &&
    document.documentType.startsWith("ACORD_") &&
    !/ACORD/i.test(text)
  ) {
    mismatches.push("Missing ACORD branding/logo text in claimed ACORD form");
  }

  // Check 4: Document has no text content (suspicious for forms that should have text)
  if (text.trim().length < 50 && pageCount > 0) {
    mismatches.push(
      "Document has minimal text content — may be image-only or corrupted",
    );
  }

  // Create fraud indicator if mismatches found
  if (mismatches.length > 0) {
    const severity = mismatches.length >= 3 ? "CRITICAL" : "HIGH";

    await prisma.fraudIndicator.create({
      data: {
        submissionId: document.submissionId,
        tenantId: document.tenantId,
        documentId: document.id,
        category: "VISUAL_AI",
        indicatorName: "TEMPLATE_FORMAT_MISMATCH",
        description: `Document "${document.fileName}" (classified as ${template.description}) does not match the expected template format. ${mismatches.length} structural mismatch(es) detected: ${mismatches.join("; ")}.`,
        severity,
        evidence: JSON.parse(
          JSON.stringify({
            documentId: document.id,
            fileName: document.fileName,
            claimedType: document.documentType,
            templateDescription: template.description,
            mismatches,
            pageCount,
            expectedPageRange: `${template.pageCountMin}-${template.pageCountMax}`,
            keywordMatchRatio: Math.round(keywordMatchRatio * 100) + "%",
            textLength: text.trim().length,
          }),
        ),
        confidence: 0.75,
        recommendedAction:
          "Verify the document is the correct type. Request the original document from the issuing carrier or agency. Compare against known legitimate templates for this document type.",
      },
    });
  }
}
