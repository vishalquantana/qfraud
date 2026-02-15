import { prisma } from "@/lib/prisma";
import { getFromS3 } from "@/lib/s3";
import { toJsonValue } from "@/lib/utils";

// ─── Extracted data types ────────────────────────────────

interface PropertyLocation {
  address: string | null;
  buildingValue: number | null;
  contentsValue: number | null;
  businessIncomeValue: number | null;
  constructionType: string | null;
  yearBuilt: string | null;
  squareFootage: number | null;
  occupancy: string | null;
  condition: string | null;
}

interface FieldConfidence {
  confidence: number;
  source: "regex" | "keyword" | "form-field";
}

export interface Acord140ExtractedData {
  propertyLocations: PropertyLocation[];
  totalInsuredValue: number | null;
  deductible: number | null;
  _metadata: Record<string, FieldConfidence>;
}

// ─── Extraction helpers ─────────────────────────────────

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

// ─── Field extraction functions ──────────────────────────

function extractTotalInsuredValue(
  text: string,
): { value: number; confidence: FieldConfidence } | null {
  const patterns = [
    /TOTAL\s+(?:INSURED\s+)?(?:VALUE|TIV)[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /TIV[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /TOTAL\s+VALUES?[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /TOTAL\s+PROPERTY\s+VALUE[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /GRAND\s+TOTAL[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
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

function extractDeductible(
  text: string,
): { value: number; confidence: FieldConfidence } | null {
  const patterns = [
    /DEDUCTIBLE[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /DED(?:UCTIBLE)?[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /PROPERTY\s+DEDUCTIBLE[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /ALL\s+(?:PERIL|OTHER)\s+DEDUCTIBLE[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
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

function extractPropertyLocations(
  text: string,
): { value: PropertyLocation[]; confidence: FieldConfidence } | null {
  const locations: PropertyLocation[] = [];

  // Strategy 1: Look for numbered location blocks (LOC #1, LOCATION 1, etc.)
  const locationBlocks = text.split(/(?=LOC(?:ATION)?\s*(?:#|NO\.?|NUMBER)?\s*\d)/i);

  for (const block of locationBlocks) {
    // Skip blocks that don't start with a location header
    if (!/^LOC(?:ATION)?\s*(?:#|NO\.?|NUMBER)?\s*\d/i.test(block)) continue;

    const location = extractSingleLocation(block);
    if (location) {
      locations.push(location);
    }
  }

  // Strategy 2: If no numbered locations found, try to parse as a single location
  if (locations.length === 0) {
    const location = extractSingleLocation(text);
    if (location && (location.address || location.buildingValue !== null)) {
      locations.push(location);
    }
  }

  if (locations.length > 0) {
    return {
      value: locations,
      confidence: { confidence: 0.6, source: "regex" },
    };
  }
  return null;
}

function extractSingleLocation(block: string): PropertyLocation | null {
  const address = extractLocationAddress(block);
  const buildingValue = extractCurrencyField(block, [
    /BUILDING\s+(?:VALUE|AMOUNT|LIMIT)[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /BLDG\.?\s+(?:VALUE|AMOUNT|LIMIT)[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /BUILDING[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
  ]);
  const contentsValue = extractCurrencyField(block, [
    /CONTENTS?\s+(?:VALUE|AMOUNT|LIMIT)[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /BPP\s+(?:VALUE|AMOUNT|LIMIT)?[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /PERSONAL\s+PROPERTY[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
  ]);
  const businessIncomeValue = extractCurrencyField(block, [
    /BUSINESS\s+INCOME\s+(?:VALUE|AMOUNT|LIMIT)?[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /BI(?:\s+\/\s*EE)?[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /LOSS\s+OF\s+(?:INCOME|EARNINGS)[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /EXTRA\s+EXPENSE[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
  ]);
  const constructionType = extractConstructionType(block);
  const yearBuilt = extractYearBuilt(block);
  const squareFootage = extractSquareFootage(block);
  const occupancy = extractOccupancy(block);
  const condition = extractCondition(block);

  // Only return if at least some useful data was found
  if (
    address ||
    buildingValue !== null ||
    contentsValue !== null ||
    constructionType ||
    yearBuilt
  ) {
    return {
      address,
      buildingValue,
      contentsValue,
      businessIncomeValue,
      constructionType,
      yearBuilt,
      squareFootage,
      occupancy,
      condition,
    };
  }
  return null;
}

function extractLocationAddress(block: string): string | null {
  const result = extractField(block, [
    /(?:LOCATION|PROPERTY|PREMISES)\s*ADDRESS[:\s]*([A-Za-z0-9\s,.#'-]{5,120})/i,
    /ADDRESS[:\s]*([A-Za-z0-9\s,.#'-]{5,120})/i,
    /STREET[:\s]*([A-Za-z0-9\s,.#'-]{5,120})/i,
  ]);
  return result?.value ?? null;
}

function extractCurrencyField(block: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(block);
    if (match && match[1]) {
      return parseCurrency(match[1]);
    }
  }
  return null;
}

function extractConstructionType(block: string): string | null {
  const result = extractField(block, [
    /CONSTRUCTION\s*(?:TYPE|CLASS)?[:\s]*([A-Za-z\s/-]{2,40})/i,
    /CONST(?:RUCTION)?\.?\s*(?:TYPE)?[:\s]*([A-Za-z\s/-]{2,40})/i,
  ]);
  if (result) return result.value;

  // Check for known construction types as keywords
  const types = [
    "FRAME",
    "JOISTED MASONRY",
    "NON-COMBUSTIBLE",
    "MASONRY NON-COMBUSTIBLE",
    "MODIFIED FIRE RESISTIVE",
    "FIRE RESISTIVE",
    "SUPERIOR",
    "METAL",
    "WOOD FRAME",
  ];
  for (const type of types) {
    const pattern = new RegExp(`\\b${type}\\b`, "i");
    if (pattern.test(block)) {
      return type;
    }
  }
  return null;
}

function extractYearBuilt(block: string): string | null {
  const result = extractField(block, [
    /YEAR\s+BUILT[:\s]*((?:19|20)\d{2})/i,
    /BUILT[:\s]*((?:19|20)\d{2})/i,
    /YR\.?\s*BUILT[:\s]*((?:19|20)\d{2})/i,
    /CONSTRUCTED[:\s]*((?:19|20)\d{2})/i,
  ]);
  return result?.value ?? null;
}

function extractSquareFootage(block: string): number | null {
  const patterns = [
    /(?:SQUARE\s*FOOTAGE|SQ\.?\s*FT\.?|AREA)[:\s]*([\d,]+)/i,
    /(\d{3,7})\s*(?:SQ\.?\s*FT\.?|SQUARE\s*FEET)/i,
    /TOTAL\s+(?:AREA|SQ\.?\s*FT\.?)[:\s]*([\d,]+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(block);
    if (match && match[1]) {
      return parseInteger(match[1]);
    }
  }
  return null;
}

function extractOccupancy(block: string): string | null {
  const result = extractField(block, [
    /OCCUPANCY\s*(?:TYPE)?[:\s]*([A-Za-z\s,.&/'-]{2,60})/i,
    /(?:OCCUPIED\s+(?:AS|BY))[:\s]*([A-Za-z\s,.&/'-]{2,60})/i,
    /USE\s*(?:OF\s+PREMISES)?[:\s]*([A-Za-z\s,.&/'-]{2,60})/i,
  ]);
  return result?.value ?? null;
}

function extractCondition(block: string): string | null {
  const result = extractField(block, [
    /CONDITION[:\s]*([A-Za-z\s]{2,30})/i,
    /BUILDING\s+CONDITION[:\s]*([A-Za-z\s]{2,30})/i,
  ]);
  if (result) return result.value;

  // Check for known condition keywords
  const conditions = ["EXCELLENT", "GOOD", "AVERAGE", "FAIR", "POOR"];
  for (const cond of conditions) {
    const pattern = new RegExp(`\\bCONDITION[:\\s]*${cond}\\b`, "i");
    if (pattern.test(block)) {
      return cond;
    }
  }
  return null;
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
 * Extract structured fields from an ACORD 140 Property Section form.
 *
 * Reads the PDF content from S3 and uses regex/pattern-based extraction
 * to identify property locations with values, construction details,
 * and total insured value/deductible.
 *
 * Updates the document record with extractedData JSON and sets status to ANALYZED.
 */
export async function extractAcord140(documentId: string): Promise<Acord140ExtractedData> {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
  });

  try {
    const text = await extractPdfText(doc.s3Key);

    const metadata: Record<string, FieldConfidence> = {};

    // Extract all fields
    const propertyLocationsResult = extractPropertyLocations(text);
    const totalInsuredValueResult = extractTotalInsuredValue(text);
    const deductibleResult = extractDeductible(text);

    // Build metadata
    if (propertyLocationsResult)
      metadata.propertyLocations = propertyLocationsResult.confidence;
    if (totalInsuredValueResult)
      metadata.totalInsuredValue = totalInsuredValueResult.confidence;
    if (deductibleResult) metadata.deductible = deductibleResult.confidence;

    const extractedData: Acord140ExtractedData = {
      propertyLocations: propertyLocationsResult?.value ?? [],
      totalInsuredValue: totalInsuredValueResult?.value ?? null,
      deductible: deductibleResult?.value ?? null,
      _metadata: metadata,
    };

    // Update document with extracted data and set status to ANALYZED
    await prisma.document.update({
      where: { id: documentId },
      data: {
        extractedData: toJsonValue(extractedData),
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
