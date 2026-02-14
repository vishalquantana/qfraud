import { prisma } from "@/lib/prisma";
import { getFromS3 } from "@/lib/s3";

// ─── Extracted data types ────────────────────────────────

interface PayrollClassification {
  classCode: string;
  description: string | null;
  payroll: number | null;
  employeeCount: number | null;
}

interface FieldConfidence {
  confidence: number;
  source: "regex" | "keyword" | "form-field";
}

export interface Acord130ExtractedData {
  totalPayroll: number | null;
  payrollByClassification: PayrollClassification[];
  eModRate: number | null;
  priorCarrier: string | null;
  experienceModWorksheet: string | null;
  _metadata: Record<string, FieldConfidence>;
}

// ─── Extraction helpers ─────────────────────────────────

function extractField(
  text: string,
  patterns: RegExp[],
  source: "regex" | "keyword" | "form-field" = "regex",
): { value: string; confidence: FieldConfidence } | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const value = match[1].trim();
      if (value.length > 0) {
        return {
          value,
          confidence: { confidence: 0.7, source },
        };
      }
    }
  }
  return null;
}

function parseCurrency(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseInteger(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

// ─── Field extraction functions ──────────────────────────

function extractTotalPayroll(
  text: string,
): { value: number; confidence: FieldConfidence } | null {
  const patterns = [
    /TOTAL\s+PAYROLL[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /TOTAL\s+ESTIMATED\s+ANNUAL\s+REMUNERATION[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /ESTIMATED\s+ANNUAL\s+PAYROLL[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /ANNUAL\s+PAYROLL[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /TOTAL\s+REMUNERATION[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const value = parseCurrency(match[1]);
      if (value !== null) {
        return { value, confidence: { confidence: 0.7, source: "regex" } };
      }
    }
  }
  return null;
}

function extractPayrollByClassification(
  text: string,
): { value: PayrollClassification[]; confidence: FieldConfidence } | null {
  const classifications: PayrollClassification[] = [];

  // Pattern: class code followed by description, payroll, and employee count
  // Common ACORD 130 table patterns:
  // CLASS CODE | DESCRIPTION | # EMPLOYEES | EST. ANNUAL REMUNERATION
  // Try the more specific pattern first (with employee count)
  const fullPattern =
    /(\d{4})\s+([A-Za-z\s,.&/'-]{3,60}?)\s+(\d{1,5})\s+\$?([\d,]+(?:\.\d{1,2})?)/g;
  let match;
  while ((match = fullPattern.exec(text)) !== null) {
    const payroll = parseCurrency(match[4]);
    const employeeCount = parseInteger(match[3]);
    classifications.push({
      classCode: match[1],
      description: match[2].trim(),
      payroll,
      employeeCount,
    });
  }

  // If no matches with full pattern, try simpler pattern
  if (classifications.length === 0) {
    const simplePattern =
      /(?:CLASS(?:\s*CODE)?|CODE)[:\s]*(\d{4})[:\s]*([A-Za-z\s,.&/'-]{3,60}?)(?:\s+\$?([\d,]+(?:\.\d{1,2})?))?/gi;
    while ((match = simplePattern.exec(text)) !== null) {
      const payroll = match[3] ? parseCurrency(match[3]) : null;
      classifications.push({
        classCode: match[1],
        description: match[2].trim(),
        payroll,
        employeeCount: null,
      });
    }
  }

  if (classifications.length > 0) {
    return {
      value: classifications,
      confidence: { confidence: 0.6, source: "regex" },
    };
  }
  return null;
}

function extractEModRate(
  text: string,
): { value: number; confidence: FieldConfidence } | null {
  const patterns = [
    /E[\s-]*MOD(?:IFICATION)?\s*(?:RATE|FACTOR)?[:\s]*([\d.]+)/i,
    /EXPERIENCE\s+MOD(?:IFICATION)?\s*(?:RATE|FACTOR)?[:\s]*([\d.]+)/i,
    /EMR[:\s]*([\d.]+)/i,
    /MOD(?:IFICATION)?\s+RATE[:\s]*([\d.]+)/i,
    /INTERSTATE\s+MOD(?:IFICATION)?[:\s]*([\d.]+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const value = parseFloat(match[1]);
      if (!isNaN(value) && value > 0 && value < 10) {
        return { value, confidence: { confidence: 0.7, source: "regex" } };
      }
    }
  }
  return null;
}

function extractPriorCarrier(text: string) {
  return extractField(text, [
    /PRIOR\s+CARRIER[:\s]*([A-Za-z\s,.&'-]{2,80})/i,
    /CURRENT\s+CARRIER[:\s]*([A-Za-z\s,.&'-]{2,80})/i,
    /EXPIRING\s+CARRIER[:\s]*([A-Za-z\s,.&'-]{2,80})/i,
    /PRESENT\s+(?:WORKERS?\s*COMP(?:ENSATION)?\s*)?CARRIER[:\s]*([A-Za-z\s,.&'-]{2,80})/i,
  ]);
}

function extractExperienceModWorksheet(text: string) {
  // Look for experience mod worksheet section and capture a block of text
  return extractField(text, [
    /EXPERIENCE\s+(?:MOD(?:IFICATION)?\s+)?WORKSHEET[:\s]*([A-Za-z0-9\s,.'-]{5,200})/i,
    /EXPERIENCE\s+RATING[:\s]*([A-Za-z0-9\s,.'-]{5,200})/i,
    /MOD\s+WORKSHEET[:\s]*([A-Za-z0-9\s,.'-]{5,200})/i,
  ]);
}

// ─── PDF text extraction helper ──────────────────────────

async function extractPdfText(s3Key: string): Promise<string> {
  const fileBuffer = await getFromS3(s3Key);
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });
  const result = await parser.getText();
  const text = result.text;
  await parser.destroy();
  return text;
}

// ─── Main extraction function ────────────────────────────

/**
 * Extract structured fields from an ACORD 130 Workers' Compensation Application.
 *
 * Reads the PDF content from S3 and uses regex/pattern-based extraction
 * to identify key fields including payroll classifications, e-mod rate,
 * and prior carrier information.
 *
 * Updates the document record with extractedData JSON and sets status to ANALYZED.
 */
export async function extractAcord130(documentId: string): Promise<Acord130ExtractedData> {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
  });

  try {
    const text = await extractPdfText(doc.s3Key);

    const metadata: Record<string, FieldConfidence> = {};

    // Extract all fields
    const totalPayrollResult = extractTotalPayroll(text);
    const payrollByClassResult = extractPayrollByClassification(text);
    const eModRateResult = extractEModRate(text);
    const priorCarrierResult = extractPriorCarrier(text);
    const experienceModWorksheetResult = extractExperienceModWorksheet(text);

    // Build metadata
    if (totalPayrollResult) metadata.totalPayroll = totalPayrollResult.confidence;
    if (payrollByClassResult)
      metadata.payrollByClassification = payrollByClassResult.confidence;
    if (eModRateResult) metadata.eModRate = eModRateResult.confidence;
    if (priorCarrierResult) metadata.priorCarrier = priorCarrierResult.confidence;
    if (experienceModWorksheetResult)
      metadata.experienceModWorksheet = experienceModWorksheetResult.confidence;

    const extractedData: Acord130ExtractedData = {
      totalPayroll: totalPayrollResult?.value ?? null,
      payrollByClassification: payrollByClassResult?.value ?? [],
      eModRate: eModRateResult?.value ?? null,
      priorCarrier: priorCarrierResult?.value ?? null,
      experienceModWorksheet: experienceModWorksheetResult?.value ?? null,
      _metadata: metadata,
    };

    // Update document with extracted data and set status to ANALYZED
    await prisma.document.update({
      where: { id: documentId },
      data: {
        extractedData: JSON.parse(JSON.stringify(extractedData)),
        status: "ANALYZED",
      },
    });

    return extractedData;
  } catch (error) {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "ERROR" },
    });
    throw error;
  }
}
