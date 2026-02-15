import { extractTextSmart } from "@/services/extraction-ocr";
import { aiExtractForDocumentType } from "@/services/extraction-ai";
import { createLogger } from "@/lib/logger";

const log = createLogger("extraction-dual");

// ─── Types ──────────────────────────────────────────────

export interface FieldValidation {
  match: boolean;
  confidence: number;
  regexValue: unknown;
  aiValue: unknown;
}

export interface DualExtractionResult {
  /** Merged extraction data — best value chosen from both methods. */
  mergedData: Record<string, unknown>;
  /** How the text was extracted. */
  textSource: "pdf-parse" | "tesseract-ocr";
  /** Whether OCR was used. */
  isOcr: boolean;
  /** Whether Gemini AI extraction was available. */
  aiAvailable: boolean;
  /** Number of pages (if known). */
  pageCount?: number;
  /** Per-field cross-validation results (when both methods produced data). */
  validation?: Record<string, FieldValidation>;
  /** Overall confidence score (0-1) based on cross-validation. */
  overallConfidence: number;
}

// ─── Regex-based field extraction (simplified for cross-validation) ──

/**
 * Very lightweight regex extraction from raw text.
 * Used for cross-validation against AI extraction — does NOT replace
 * the full document-specific extractors in extraction-acord125.ts etc.
 */
function quickRegexExtract(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Applicant / Insured name
  const nameMatch = text.match(
    /(?:APPLICANT|INSURED|NAMED INSURED|COMPANY)\s*(?:NAME)?[:\s]*([A-Z][A-Za-z0-9\s,.&'-]{2,80})/i,
  );
  if (nameMatch) result.applicantName = nameMatch[1].trim();

  // Annual revenue
  const revenueMatch = text.match(
    /(?:ANNUAL|GROSS|TOTAL)\s*(?:REVENUE|SALES)[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
  );
  if (revenueMatch) {
    const val = parseFloat(revenueMatch[1].replace(/,/g, ""));
    if (!isNaN(val)) result.annualRevenue = val;
  }

  // Number of employees
  const empMatch = text.match(
    /(?:NUMBER|#|NO\.?|TOTAL)\s*(?:OF\s+)?EMPLOYEES?[:\s]*([\d,]+)/i,
  );
  if (empMatch) {
    const val = parseInt(empMatch[1].replace(/,/g, ""), 10);
    if (!isNaN(val)) result.numberOfEmployees = val;
  }

  // NAICS code
  const naicsMatch = text.match(/NAICS[:\s#]*(\d{4,6})/i);
  if (naicsMatch) result.naicsCode = naicsMatch[1];

  // Effective date
  const effMatch = text.match(
    /EFFECTIVE\s+DATE[:\s]*([\d/.-]+)/i,
  );
  if (effMatch) result.effectiveDate = effMatch[1].trim();

  // Expiration date
  const expMatch = text.match(
    /EXPIR(?:ATION|ES?)?\s+DATE[:\s]*([\d/.-]+)/i,
  );
  if (expMatch) result.expirationDate = expMatch[1].trim();

  // Revenue (financial statement)
  const revMatch = text.match(
    /(?:^|\n)\s*(?:TOTAL\s+)?REVENUE[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/im,
  );
  if (revMatch && !result.annualRevenue) {
    const val = parseFloat(revMatch[1].replace(/,/g, ""));
    if (!isNaN(val)) result.revenue = val;
  }

  // Net income
  const niMatch = text.match(
    /NET\s+INCOME[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
  );
  if (niMatch) {
    const val = parseFloat(niMatch[1].replace(/,/g, ""));
    if (!isNaN(val)) result.netIncome = val;
  }

  // Policy number
  const polMatch = text.match(
    /POLICY\s*(?:NUMBER|#|NO\.?)[:\s]*([A-Za-z0-9-]{3,30})/i,
  );
  if (polMatch) result.policyNumber = polMatch[1].trim();

  // Carrier name
  const carrierMatch = text.match(
    /(?:CARRIER|INSURER|INSURANCE\s+COMPANY)[:\s]*([A-Za-z\s,.&'-]{3,80})/i,
  );
  if (carrierMatch) result.carrierName = carrierMatch[1].trim();

  return result;
}

// ─── Cross-validation ───────────────────────────────────

/**
 * Compare two field values and determine if they match.
 * Handles strings (fuzzy), numbers (within 5%), and null values.
 */
function compareValues(a: unknown, b: unknown): { match: boolean; confidence: number } {
  // Both null = agreement on absence
  if (a == null && b == null) {
    return { match: true, confidence: 0.5 };
  }

  // One null, one present = partial data
  if (a == null || b == null) {
    return { match: false, confidence: 0.3 };
  }

  // Numeric comparison with tolerance
  if (typeof a === "number" && typeof b === "number") {
    if (a === b) return { match: true, confidence: 0.95 };
    const maxVal = Math.max(Math.abs(a), Math.abs(b));
    if (maxVal === 0) return { match: true, confidence: 0.95 };
    const diff = Math.abs(a - b) / maxVal;
    if (diff <= 0.05) return { match: true, confidence: 0.85 };
    if (diff <= 0.15) return { match: false, confidence: 0.4 };
    return { match: false, confidence: 0.2 };
  }

  // String comparison (case-insensitive, normalized whitespace)
  if (typeof a === "string" && typeof b === "string") {
    const normA = normalizeString(a);
    const normB = normalizeString(b);

    if (normA === normB) return { match: true, confidence: 0.95 };

    // Check if one contains the other
    if (normA.includes(normB) || normB.includes(normA)) {
      return { match: true, confidence: 0.8 };
    }

    // Simple similarity check (shared words)
    const wordsA = new Set(normA.split(/\s+/));
    const wordsB = new Set(normB.split(/\s+/));
    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    const jaccard = union.size > 0 ? intersection.size / union.size : 0;

    if (jaccard >= 0.7) return { match: true, confidence: 0.7 };
    if (jaccard >= 0.4) return { match: false, confidence: 0.4 };
    return { match: false, confidence: 0.15 };
  }

  // Boolean comparison
  if (typeof a === "boolean" && typeof b === "boolean") {
    return a === b
      ? { match: true, confidence: 0.95 }
      : { match: false, confidence: 0.2 };
  }

  // Default: different types or complex types
  return { match: false, confidence: 0.3 };
}

function normalizeString(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Cross-validate fields between regex extraction and AI extraction.
 * Compares each shared field and produces per-field confidence scores.
 */
export function crossValidateFields(
  regexResult: Record<string, unknown>,
  aiResult: Record<string, unknown>,
): Record<string, FieldValidation> {
  const allKeys = new Set([
    ...Object.keys(regexResult),
    ...Object.keys(aiResult),
  ]);

  // Exclude metadata keys
  allKeys.delete("_metadata");

  const validation: Record<string, FieldValidation> = {};

  for (const key of allKeys) {
    const regexVal = regexResult[key] ?? null;
    const aiVal = aiResult[key] ?? null;
    const { match, confidence } = compareValues(regexVal, aiVal);

    validation[key] = {
      match,
      confidence,
      regexValue: regexVal,
      aiValue: aiVal,
    };
  }

  return validation;
}

// ─── Merge strategy ─────────────────────────────────────

/**
 * Merge regex and AI results, preferring agreed-upon values.
 * When they disagree, prefer AI (higher quality), but flag lower confidence.
 */
function mergeResults(
  regexResult: Record<string, unknown>,
  aiResult: Record<string, unknown> | null,
  validation: Record<string, FieldValidation> | null,
): Record<string, unknown> {
  // AI-only: just use AI result
  if (Object.keys(regexResult).length === 0 && aiResult) {
    const { _metadata, ...data } = aiResult;
    return data;
  }

  // Regex-only: just use regex result
  if (!aiResult) {
    return { ...regexResult };
  }

  // Both available: merge with preference
  const merged: Record<string, unknown> = {};
  const allKeys = new Set([
    ...Object.keys(regexResult),
    ...Object.keys(aiResult),
  ]);
  allKeys.delete("_metadata");

  for (const key of allKeys) {
    const regexVal = regexResult[key] ?? null;
    const aiVal = aiResult[key] ?? null;
    const fieldValidation = validation?.[key];

    if (fieldValidation?.match) {
      // Both agree: use AI value (tends to be cleaner)
      merged[key] = aiVal ?? regexVal;
    } else if (regexVal != null && aiVal != null) {
      // Disagree: prefer AI (generally more accurate)
      merged[key] = aiVal;
    } else {
      // One is null: use whichever has a value
      merged[key] = aiVal ?? regexVal;
    }
  }

  return merged;
}

// ─── Public API ─────────────────────────────────────────

/**
 * Dual extraction pipeline: runs both regex and AI extraction on a document,
 * cross-validates the results, and returns a merged result with confidence scores.
 *
 * @param s3Key - S3 key for the document file
 * @param documentType - Document type (e.g., "ACORD_125", "FINANCIAL_STATEMENT")
 * @returns Dual extraction result with merged data and validation, or null on complete failure
 */
export async function dualExtract(
  s3Key: string,
  documentType: string,
): Promise<DualExtractionResult | null> {
  // Step 1: Smart text extraction (pdf-parse → OCR fallback)
  const textResult = await extractTextSmart(s3Key);

  // Step 2: Run both extraction methods in parallel
  const [regexResult, aiResult] = await Promise.all([
    Promise.resolve(quickRegexExtract(textResult.text)),
    aiExtractForDocumentType(documentType, textResult.text),
  ]);

  // Step 3: Cross-validate if both methods produced results
  const aiData = aiResult ? (() => {
    const { _metadata, ...rest } = aiResult;
    return rest;
  })() : null;

  let validation: Record<string, FieldValidation> | undefined;
  if (aiData && Object.keys(regexResult).length > 0) {
    validation = crossValidateFields(regexResult, aiData);
  }

  // Step 4: Merge results
  const mergedData = mergeResults(regexResult, aiData, validation ?? null);

  // Step 5: Calculate overall confidence
  let overallConfidence: number;
  if (validation) {
    const fieldConfidences = Object.values(validation).map((v) => v.confidence);
    overallConfidence =
      fieldConfidences.length > 0
        ? fieldConfidences.reduce((sum, c) => sum + c, 0) / fieldConfidences.length
        : 0.5;
  } else if (aiResult) {
    // AI-only extraction
    overallConfidence = 0.7;
  } else {
    // Regex-only extraction
    overallConfidence = 0.5;
  }

  log.info(
    {
      s3Key,
      documentType,
      textSource: textResult.source,
      isOcr: textResult.isOcr,
      aiAvailable: !!aiResult,
      overallConfidence,
      fieldCount: Object.keys(mergedData).length,
    },
    "dual extraction complete",
  );

  return {
    mergedData,
    textSource: textResult.source,
    isOcr: textResult.isOcr,
    aiAvailable: !!aiResult,
    pageCount: textResult.pageCount,
    validation,
    overallConfidence,
  };
}
