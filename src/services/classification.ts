import { prisma } from "@/lib/prisma";
import { getFromS3 } from "@/lib/s3";
import type { DocumentType } from "@/generated/prisma/client";

// ─── Filename-based classification patterns ─────────────────

const FILENAME_PATTERNS: { pattern: RegExp; type: DocumentType }[] = [
  { pattern: /acord.?125/i, type: "ACORD_125" },
  { pattern: /acord.?130/i, type: "ACORD_130" },
  { pattern: /acord.?140/i, type: "ACORD_140" },
  { pattern: /loss.?run/i, type: "LOSS_RUN" },
  {
    pattern: /financ(ial)?[\s_.-]?stat(ement)?/i,
    type: "FINANCIAL_STATEMENT",
  },
  { pattern: /\bcoi\b|certificate.?of.?insurance/i, type: "COI" },
  {
    pattern: /entity.?doc|articles?.?of.?incorp|certificate.?of.?form/i,
    type: "ENTITY_DOC",
  },
  { pattern: /inspection.?photo|property.?photo/i, type: "INSPECTION_PHOTO" },
  { pattern: /\bmvr\b|motor.?vehicle.?report/i, type: "MVR" },
  {
    pattern: /\bsov\b|schedule.?of.?values/i,
    type: "SOV",
  },
  { pattern: /surplus.?line/i, type: "SURPLUS_LINES" },
  { pattern: /professional.?lic(ense)?/i, type: "PROFESSIONAL_LICENSE" },
  { pattern: /environment(al)?.?report/i, type: "ENVIRONMENTAL_REPORT" },
  { pattern: /payroll.?tax|payroll.?report/i, type: "PAYROLL_TAX" },
  {
    pattern: /broker.?sub(mission)?|cover.?letter/i,
    type: "BROKER_SUBMISSION",
  },
  { pattern: /fleet.?sched/i, type: "FLEET_SCHEDULE" },
];

// ─── PDF text content keyword patterns ──────────────────────

const TEXT_KEYWORD_PATTERNS: {
  keywords: RegExp[];
  type: DocumentType;
  weight: number;
}[] = [
  {
    type: "ACORD_125",
    weight: 0.9,
    keywords: [
      /ACORD\s*125/i,
      /COMMERCIAL\s+INSURANCE\s+APPLICATION/i,
      /APPLICANT\s+INFORMATION/i,
    ],
  },
  {
    type: "ACORD_130",
    weight: 0.9,
    keywords: [
      /ACORD\s*130/i,
      /WORKERS\s*COMPENSATION/i,
      /EXPERIENCE\s+MODIFICATION/i,
      /PAYROLL\s+BY\s+CLASS/i,
    ],
  },
  {
    type: "ACORD_140",
    weight: 0.9,
    keywords: [
      /ACORD\s*140/i,
      /PROPERTY\s+SECTION/i,
      /BUILDING\s+DESCRIPTION/i,
      /CONSTRUCTION\s+TYPE/i,
    ],
  },
  {
    type: "LOSS_RUN",
    weight: 0.85,
    keywords: [
      /LOSS\s+RUN/i,
      /LOSS\s+HISTORY/i,
      /CLAIM\s+NUMBER/i,
      /DATE\s+OF\s+LOSS/i,
      /TOTAL\s+INCURRED/i,
    ],
  },
  {
    type: "FINANCIAL_STATEMENT",
    weight: 0.85,
    keywords: [
      /BALANCE\s+SHEET/i,
      /INCOME\s+STATEMENT/i,
      /NET\s+INCOME/i,
      /TOTAL\s+ASSETS/i,
      /TOTAL\s+LIABILITIES/i,
      /OPERATING\s+EXPENSES/i,
    ],
  },
  {
    type: "COI",
    weight: 0.9,
    keywords: [
      /CERTIFICATE\s+OF\s+(LIABILITY\s+)?INSURANCE/i,
      /CERTIFICATE\s+HOLDER/i,
      /THIS\s+CERTIFICATE\s+IS\s+ISSUED/i,
      /GENERAL\s+LIABILITY/i,
    ],
  },
  {
    type: "ENTITY_DOC",
    weight: 0.85,
    keywords: [
      /ARTICLES\s+OF\s+INCORPORATION/i,
      /CERTIFICATE\s+OF\s+FORMATION/i,
      /CERTIFICATE\s+OF\s+GOOD\s+STANDING/i,
      /REGISTERED\s+AGENT/i,
      /SECRETARY\s+OF\s+STATE/i,
    ],
  },
  {
    type: "MVR",
    weight: 0.85,
    keywords: [
      /MOTOR\s+VEHICLE\s+REPORT/i,
      /DRIVING\s+RECORD/i,
      /DRIVER\s+LICENSE/i,
      /VIOLATIONS/i,
    ],
  },
  {
    type: "SOV",
    weight: 0.85,
    keywords: [
      /SCHEDULE\s+OF\s+VALUES/i,
      /BUILDING\s+VALUE/i,
      /CONTENTS\s+VALUE/i,
      /LOCATION\s+SCHEDULE/i,
    ],
  },
  {
    type: "SURPLUS_LINES",
    weight: 0.85,
    keywords: [
      /SURPLUS\s+LINE/i,
      /EXCESS\s+LINE/i,
      /NON[\s-]?ADMITTED/i,
      /DILIGENT\s+SEARCH/i,
    ],
  },
  {
    type: "PROFESSIONAL_LICENSE",
    weight: 0.85,
    keywords: [
      /PROFESSIONAL\s+LICENSE/i,
      /LICENSE\s+NUMBER/i,
      /BOARD\s+OF/i,
      /ISSUED\s+BY/i,
    ],
  },
  {
    type: "ENVIRONMENTAL_REPORT",
    weight: 0.85,
    keywords: [
      /ENVIRONMENTAL\s+(SITE\s+)?ASSESSMENT/i,
      /PHASE\s+[I1]/i,
      /HAZARDOUS\s+SUBSTANCE/i,
      /CONTAMINATION/i,
    ],
  },
  {
    type: "PAYROLL_TAX",
    weight: 0.85,
    keywords: [
      /PAYROLL\s+TAX/i,
      /FORM\s+941/i,
      /QUARTERLY\s+FEDERAL\s+TAX/i,
      /WAGES.*TIPS/i,
    ],
  },
  {
    type: "BROKER_SUBMISSION",
    weight: 0.8,
    keywords: [
      /SUBMISSION\s+SUMMARY/i,
      /COVER\s+LETTER/i,
      /BROKER.*SUBMISSION/i,
      /PLEASE\s+FIND\s+ATTACHED/i,
    ],
  },
  {
    type: "FLEET_SCHEDULE",
    weight: 0.85,
    keywords: [/FLEET\s+SCHEDULE/i, /VEHICLE\s+LIST/i, /\bVIN\b/, /MAKE.*MODEL/i],
  },
];

// ─── Spreadsheet sheet-name patterns ────────────────────────

const SHEET_NAME_PATTERNS: { pattern: RegExp; type: DocumentType }[] = [
  { pattern: /loss.?run/i, type: "LOSS_RUN" },
  { pattern: /sov|schedule.?of.?val/i, type: "SOV" },
  { pattern: /fleet|vehicle/i, type: "FLEET_SCHEDULE" },
  { pattern: /payroll/i, type: "PAYROLL_TAX" },
  { pattern: /financ/i, type: "FINANCIAL_STATEMENT" },
];

// ─── Image classification by filename ───────────────────────

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".tiff", ".tif"]);

function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx).toLowerCase() : "";
}

function isImageFile(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(getFileExtension(fileName));
}

function isSpreadsheet(fileName: string): boolean {
  const ext = getFileExtension(fileName);
  return ext === ".xlsx" || ext === ".xls" || ext === ".csv";
}

function isPdf(fileName: string): boolean {
  return getFileExtension(fileName) === ".pdf";
}

// ─── Classification by filename ─────────────────────────────

function classifyByFilename(
  fileName: string,
): { type: DocumentType; confidence: number } | null {
  for (const { pattern, type } of FILENAME_PATTERNS) {
    if (pattern.test(fileName)) {
      return { type, confidence: 0.7 };
    }
  }
  return null;
}

// ─── Classification by PDF text content ─────────────────────

function classifyByTextContent(
  text: string,
): { type: DocumentType; confidence: number } | null {
  let bestMatch: { type: DocumentType; confidence: number } | null = null;
  let bestScore = 0;

  for (const { keywords, type, weight } of TEXT_KEYWORD_PATTERNS) {
    let matchCount = 0;
    for (const kw of keywords) {
      if (kw.test(text)) matchCount++;
    }

    if (matchCount > 0) {
      // Score based on number of keyword matches and the base weight
      const score = (matchCount / keywords.length) * weight;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { type, confidence: Math.min(score, 0.99) };
      }
    }
  }

  return bestMatch;
}

// ─── Classification by spreadsheet analysis ─────────────────

function classifyBySheetContent(
  fileName: string,
): { type: DocumentType; confidence: number } | null {
  // Since we don't parse XLSX in this service (no xlsx dependency),
  // we classify spreadsheets primarily by filename. This is a placeholder
  // for future sheet-name analysis with a proper XLSX parser.
  for (const { pattern, type } of SHEET_NAME_PATTERNS) {
    if (pattern.test(fileName)) {
      return { type, confidence: 0.6 };
    }
  }
  return null;
}

// ─── Main classification function ───────────────────────────

export interface ClassificationResult {
  documentType: DocumentType;
  confidence: number;
}

/**
 * Classify a document by reading the file from S3 and determining its type.
 *
 * Classification strategy:
 * 1. Filename patterns (quick, moderate confidence)
 * 2. PDF text content keywords (high confidence for PDFs)
 * 3. Spreadsheet sheet-name analysis (for XLSX files)
 * 4. Images default to INSPECTION_PHOTO
 * 5. Falls back to UNKNOWN
 *
 * Updates the document record with documentType, classificationConfidence,
 * and status (CLASSIFYING → EXTRACTING on success, ERROR on failure).
 */
export async function classifyDocument(
  documentId: string,
): Promise<ClassificationResult> {
  // Set status to CLASSIFYING
  const doc = await prisma.document.update({
    where: { id: documentId },
    data: { status: "CLASSIFYING" },
  });

  try {
    const { fileName, s3Key } = doc;

    // Strategy 1: Filename-based classification
    const filenameResult = classifyByFilename(fileName);

    // Strategy 2: Content-based classification for PDFs
    let textResult: { type: DocumentType; confidence: number } | null = null;
    if (isPdf(fileName)) {
      try {
        const fileBuffer = await getFromS3(s3Key);
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });
        const result = await parser.getText();
        const text = result.text;
        await parser.destroy();

        if (text && text.trim().length > 0) {
          textResult = classifyByTextContent(text);
        }
      } catch {
        // PDF parsing failed — continue with other strategies
      }
    }

    // Strategy 3: Spreadsheet analysis
    let sheetResult: { type: DocumentType; confidence: number } | null = null;
    if (isSpreadsheet(fileName)) {
      sheetResult = classifyBySheetContent(fileName);
    }

    // Strategy 4: Image files default to INSPECTION_PHOTO
    let imageResult: { type: DocumentType; confidence: number } | null = null;
    if (isImageFile(fileName)) {
      imageResult = { type: "INSPECTION_PHOTO" as DocumentType, confidence: 0.5 };
    }

    // Pick the highest-confidence result
    const candidates = [textResult, filenameResult, sheetResult, imageResult].filter(
      (r): r is { type: DocumentType; confidence: number } => r !== null,
    );

    let bestResult: ClassificationResult;
    if (candidates.length === 0) {
      bestResult = { documentType: "UNKNOWN", confidence: 0 };
    } else {
      candidates.sort((a, b) => b.confidence - a.confidence);
      bestResult = {
        documentType: candidates[0].type,
        confidence: candidates[0].confidence,
      };
    }

    // Update document with classification results and move to EXTRACTING
    await prisma.document.update({
      where: { id: documentId },
      data: {
        documentType: bestResult.documentType,
        classificationConfidence: bestResult.confidence,
        status: "EXTRACTING",
      },
    });

    return bestResult;
  } catch (error) {
    // Set status to ERROR on failure
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "ERROR" },
    });
    throw error;
  }
}
