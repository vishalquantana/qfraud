import { prisma } from "@/lib/prisma";
import { geminiStructuredAnalysis, geminiAnalyzeWithImage } from "@/lib/gemini";
import { createLogger } from "@/lib/logger";

const log = createLogger("forgery-detection");

// ─── Types ──────────────────────────────────────────────

export interface ForgeryFinding {
  type: string;
  description: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  evidence: string;
}

export interface ForgeryAnalysisResult {
  isSuspicious: boolean;
  confidenceScore: number;
  findings: ForgeryFinding[];
  overallAssessment: string;
}

interface AnalyzeOptions {
  createIndicators?: boolean;
}

// ─── Prompts ────────────────────────────────────────────

const DOCUMENT_FORGERY_PROMPT = `You are an expert insurance document forensics analyst. Analyze the following document metadata and extracted data for signs of forgery, tampering, or fabrication.

Look for these red flags:
1. FONT_INCONSISTENCY — Multiple font families or sizes within sections that should be uniform
2. ALTERED_AMOUNTS — Financial figures that show signs of modification (white-out, overwritten digits, pixel inconsistencies)
3. MISMATCHED_DATES — Dates that are inconsistent across the document or with other submission documents
4. DIGITAL_MANIPULATION — Signs of digital editing (copy-paste artifacts, compression inconsistencies)
5. METADATA_ANOMALY — Document metadata that conflicts with stated origin
6. SIGNATURE_IRREGULARITY — Signatures that appear copied, pasted, or digitally generated
7. TEMPLATE_MISMATCH — Document format doesn't match known carrier/agency templates

Respond with ONLY a valid JSON object (no markdown, no explanation) in this exact format:
{
  "isSuspicious": boolean,
  "confidenceScore": number between 0 and 1,
  "findings": [
    {
      "type": "one of the types listed above",
      "description": "brief description",
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "evidence": "specific evidence found"
    }
  ],
  "overallAssessment": "brief overall assessment"
}

If the document appears genuine, set isSuspicious to false and return an empty findings array.`;

const IMAGE_FORGERY_PROMPT = `You are an expert in digital image forensics for insurance documents. Analyze this image for signs of forgery, tampering, or digital manipulation.

Look for:
1. DIGITAL_MANIPULATION — Pixel-level inconsistencies, copy-paste artifacts, clone stamping
2. ALTERED_AMOUNTS — Modified text or numbers
3. SIGNATURE_IRREGULARITY — Copied or digitally generated signatures
4. COMPRESSION_ARTIFACTS — Inconsistent JPEG compression levels indicating re-saving
5. METADATA_ANOMALY — EXIF data inconsistencies

Respond with ONLY a valid JSON object (no markdown) in this exact format:
{
  "isSuspicious": boolean,
  "confidenceScore": number between 0 and 1,
  "findings": [
    {
      "type": "type from above list",
      "description": "brief description",
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "evidence": "specific evidence"
    }
  ],
  "overallAssessment": "brief assessment"
}`;

// ─── Public API ─────────────────────────────────────────

/**
 * Analyze a document for signs of forgery using Gemini AI.
 * Fetches document metadata and extracted data, then sends to Gemini for analysis.
 *
 * @param documentId - The document ID to analyze
 * @param options - Whether to auto-create FraudIndicator records
 * @returns Analysis result or null if Gemini is unavailable
 */
export async function analyzeDocumentForgery(
  documentId: string,
  options: AnalyzeOptions = {},
): Promise<ForgeryAnalysisResult | null> {
  const { createIndicators = false } = options;

  const document = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { submission: true },
  });

  // Build context from document metadata
  const context = [
    `Document Type: ${document.documentType}`,
    `File Name: ${document.fileName}`,
    `File Type: ${document.fileType}`,
    `File Size: ${document.fileSize} bytes`,
    `Classification Confidence: ${document.classificationConfidence}`,
    `Submission Date: ${document.submission.createdAt.toISOString()}`,
    document.extractedData
      ? `Extracted Data: ${JSON.stringify(document.extractedData)}`
      : "Extracted Data: None",
  ].join("\n");

  const result = await geminiStructuredAnalysis<ForgeryAnalysisResult>(
    DOCUMENT_FORGERY_PROMPT,
    context,
  );

  if (!result) {
    log.warn({ documentId }, "forgery analysis returned null");
    return null;
  }

  // Create fraud indicators if requested and findings exist
  if (createIndicators && result.isSuspicious && result.findings.length > 0) {
    for (const finding of result.findings) {
      await prisma.fraudIndicator.create({
        data: {
          submissionId: document.submissionId,
          tenantId: document.tenantId,
          documentId: document.id,
          category: "FORENSIC",
          indicatorName: `AI_FORGERY_${finding.type}`,
          description: finding.description,
          severity: finding.severity,
          evidence: JSON.parse(
            JSON.stringify({
              type: finding.type,
              evidence: finding.evidence,
              overallAssessment: result.overallAssessment,
              aiConfidence: result.confidenceScore,
            }),
          ),
          confidence: result.confidenceScore,
          recommendedAction:
            "AI-detected forgery indicator. Manual review of the original document is recommended.",
        },
      });
    }

    log.info(
      { documentId, findingCount: result.findings.length },
      "created forgery indicators",
    );
  }

  return result;
}

/**
 * Analyze an image for signs of forgery using Gemini Vision.
 *
 * @param imageBuffer - The raw image buffer
 * @param mimeType - MIME type of the image (e.g., "image/jpeg")
 * @returns Analysis result or null if unavailable
 */
export async function analyzeImageForgery(
  imageBuffer: Buffer,
  mimeType: string,
): Promise<ForgeryAnalysisResult | null> {
  const rawResponse = await geminiAnalyzeWithImage(
    IMAGE_FORGERY_PROMPT,
    imageBuffer,
    mimeType,
  );

  if (!rawResponse) {
    return null;
  }

  try {
    const cleaned = rawResponse
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    return JSON.parse(cleaned) as ForgeryAnalysisResult;
  } catch (error) {
    log.error({ err: error }, "failed to parse image forgery response");
    return null;
  }
}
