import { prisma } from "@/lib/prisma";
import { getFromS3 } from "@/lib/s3";

// ─── Extracted data types ────────────────────────────────

interface LossRunClaim {
  claimNumber: string | null;
  dateOfLoss: string | null;
  claimType: string | null;
  status: string | null;
  paidAmount: number | null;
  reserveAmount: number | null;
  totalIncurred: number | null;
}

interface FieldConfidence {
  confidence: number;
  source: "regex" | "keyword" | "form-field";
}

export interface LossRunExtractedData {
  carrierName: string | null;
  policyPeriod: string | null;
  claims: LossRunClaim[];
  totalClaimCount: number | null;
  totalIncurred: number | null;
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

function extractCarrierName(text: string) {
  return extractField(text, [
    /(?:CARRIER|INSURER|INSURANCE\s+COMPANY)[:\s]*([A-Za-z\s,.&'-]{2,80})/i,
    /(?:ISSUED\s+BY|WRITTEN\s+BY|UNDERWRITTEN\s+BY)[:\s]*([A-Za-z\s,.&'-]{2,80})/i,
    /(?:COMPANY\s+NAME|INSURING\s+COMPANY)[:\s]*([A-Za-z\s,.&'-]{2,80})/i,
    /LOSS\s+RUN\s+(?:FOR|FROM)[:\s]*([A-Za-z\s,.&'-]{2,80})/i,
  ]);
}

function extractPolicyPeriod(text: string) {
  return extractField(text, [
    /POLICY\s+PERIOD[:\s]*([\d/.-]+\s*(?:TO|THRU|[-–])\s*[\d/.-]+)/i,
    /PERIOD[:\s]*([\d/.-]+\s*(?:TO|THRU|[-–])\s*[\d/.-]+)/i,
    /EFF(?:ECTIVE)?[:\s]*([\d/.-]+)\s*(?:TO|THRU|[-–])\s*(?:EXP(?:IRATION)?[:\s]*)?([\d/.-]+)/i,
    /FROM[:\s]*([\d/.-]+\s*(?:TO|THRU|[-–])\s*[\d/.-]+)/i,
  ]);
}

function extractClaims(
  text: string,
): { value: LossRunClaim[]; confidence: FieldConfidence } | null {
  const claims: LossRunClaim[] = [];

  // Strategy 1: Structured table rows with claim number, date, type, status, amounts
  // Common loss run formats: CLAIM # | DATE OF LOSS | TYPE | STATUS | PAID | RESERVE | TOTAL INCURRED
  const tablePattern =
    /([A-Z0-9][-A-Z0-9]{2,20})\s+([\d/.-]+)\s+([A-Za-z\s/&-]{2,30}?)\s+(OPEN|CLOSED|REOPENED|RESERVED|SETTLED|SUBROGATION|DENIED)[,\s]+\$?([\d,]+(?:\.\d{1,2})?)\s+\$?([\d,]+(?:\.\d{1,2})?)\s+\$?([\d,]+(?:\.\d{1,2})?)/gi;
  let match;
  while ((match = tablePattern.exec(text)) !== null) {
    claims.push({
      claimNumber: match[1].trim(),
      dateOfLoss: match[2].trim(),
      claimType: match[3].trim(),
      status: match[4].trim().toUpperCase(),
      paidAmount: parseCurrency(match[5]),
      reserveAmount: parseCurrency(match[6]),
      totalIncurred: parseCurrency(match[7]),
    });
  }

  // Strategy 2: Simpler pattern — claim number and date with some amounts
  if (claims.length === 0) {
    const simplePattern =
      /(?:CLAIM\s*(?:#|NO\.?|NUMBER)?[:\s]*)?([A-Z0-9][-A-Z0-9]{2,20})\s+([\d/.-]+)\s+.*?\$?([\d,]+(?:\.\d{1,2})?)/gi;
    while ((match = simplePattern.exec(text)) !== null) {
      // Skip if it looks like a policy number or date range
      if (/POLICY|PERIOD|EFF/i.test(match[0])) continue;
      claims.push({
        claimNumber: match[1].trim(),
        dateOfLoss: match[2].trim(),
        claimType: null,
        status: null,
        paidAmount: parseCurrency(match[3]),
        reserveAmount: null,
        totalIncurred: null,
      });
    }
  }

  // Strategy 3: Look for individual claim blocks
  if (claims.length === 0) {
    const claimBlocks = text.split(/(?=CLAIM\s*(?:#|NO\.?|NUMBER)?[:\s]*[A-Z0-9])/i);
    for (const block of claimBlocks) {
      if (!/^CLAIM/i.test(block)) continue;
      const claimNum = extractField(block, [
        /CLAIM\s*(?:#|NO\.?|NUMBER)?[:\s]*([A-Z0-9][-A-Z0-9]{2,20})/i,
      ]);
      const dateOfLoss = extractField(block, [
        /DATE\s+OF\s+LOSS[:\s]*([\d/.-]+)/i,
        /LOSS\s+DATE[:\s]*([\d/.-]+)/i,
        /DOL[:\s]*([\d/.-]+)/i,
      ]);
      if (claimNum) {
        const paid = extractCurrencyFromBlock(block, [
          /PAID\s*(?:AMOUNT)?[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
          /AMOUNT\s+PAID[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
        ]);
        const reserve = extractCurrencyFromBlock(block, [
          /RESERVE\s*(?:AMOUNT)?[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
          /OUTSTANDING\s+RESERVE[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
        ]);
        const incurred = extractCurrencyFromBlock(block, [
          /TOTAL\s+INCURRED[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
          /INCURRED[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
        ]);
        const claimType = extractField(block, [
          /(?:CLAIM\s+)?TYPE[:\s]*([A-Za-z\s/&-]{2,30})/i,
          /LOSS\s+TYPE[:\s]*([A-Za-z\s/&-]{2,30})/i,
          /COVERAGE[:\s]*([A-Za-z\s/&-]{2,30})/i,
        ]);
        const status = extractField(block, [
          /STATUS[:\s]*(OPEN|CLOSED|REOPENED|RESERVED|SETTLED|SUBROGATION|DENIED)/i,
        ]);

        claims.push({
          claimNumber: claimNum.value,
          dateOfLoss: dateOfLoss?.value ?? null,
          claimType: claimType?.value ?? null,
          status: status?.value?.toUpperCase() ?? null,
          paidAmount: paid,
          reserveAmount: reserve,
          totalIncurred: incurred,
        });
      }
    }
  }

  if (claims.length > 0) {
    return {
      value: claims,
      confidence: { confidence: 0.6, source: "regex" },
    };
  }
  return null;
}

function extractCurrencyFromBlock(block: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(block);
    if (match && match[1]) {
      return parseCurrency(match[1]);
    }
  }
  return null;
}

function extractTotalClaimCount(
  text: string,
  parsedClaimsCount: number,
): { value: number; confidence: FieldConfidence } | null {
  // Try to find an explicit total claim count
  const patterns = [
    /TOTAL\s+(?:NUMBER\s+OF\s+)?CLAIMS?[:\s]*([\d,]+)/i,
    /(?:NUMBER|#|NO\.?)\s+(?:OF\s+)?CLAIMS?[:\s]*([\d,]+)/i,
    /CLAIM\s+COUNT[:\s]*([\d,]+)/i,
    /([\d,]+)\s+TOTAL\s+CLAIMS?/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const value = parseInteger(match[1]);
      if (value !== null) {
        return { value, confidence: { confidence: 0.7, source: "regex" } };
      }
    }
  }

  // Fall back to the count of parsed claims
  if (parsedClaimsCount > 0) {
    return {
      value: parsedClaimsCount,
      confidence: { confidence: 0.5, source: "regex" },
    };
  }
  return null;
}

function extractTotalIncurred(
  text: string,
  claims: LossRunClaim[],
): { value: number; confidence: FieldConfidence } | null {
  // Try to find explicit total incurred
  const patterns = [
    /TOTAL\s+INCURRED[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /GRAND\s+TOTAL[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /TOTAL\s+LOSSES[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /TOTAL\s+(?:PAID\s+&?\s*RESERVE|LOSS(?:ES)?)[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
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

  // Fall back to summing claim totals
  if (claims.length > 0) {
    let sum = 0;
    let hasValue = false;
    for (const claim of claims) {
      if (claim.totalIncurred !== null) {
        sum += claim.totalIncurred;
        hasValue = true;
      } else if (claim.paidAmount !== null) {
        sum += claim.paidAmount + (claim.reserveAmount ?? 0);
        hasValue = true;
      }
    }
    if (hasValue) {
      return {
        value: sum,
        confidence: { confidence: 0.5, source: "regex" },
      };
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

// ─── Carrier format normalization ────────────────────────

/** Normalizes varying carrier loss run formats to the standard schema. */
function normalizeClaims(claims: LossRunClaim[]): LossRunClaim[] {
  return claims.map((claim) => {
    // Compute totalIncurred if missing but paid and reserve are available
    const totalIncurred =
      claim.totalIncurred ??
      (claim.paidAmount !== null ? (claim.paidAmount ?? 0) + (claim.reserveAmount ?? 0) : null);

    // Normalize status values
    let status = claim.status;
    if (status) {
      const statusMap: Record<string, string> = {
        O: "OPEN",
        C: "CLOSED",
        R: "REOPENED",
        REOPEN: "REOPENED",
        CLSD: "CLOSED",
        OPN: "OPEN",
        SETTLED: "CLOSED",
        SUB: "SUBROGATION",
        SUBR: "SUBROGATION",
      };
      status = statusMap[status] ?? status;
    }

    return {
      ...claim,
      totalIncurred,
      status,
    };
  });
}

// ─── Main extraction function ────────────────────────────

/**
 * Extract structured fields from a loss run document.
 *
 * Reads the PDF content from S3 and uses regex/pattern-based extraction
 * to identify carrier name, policy period, individual claims with amounts,
 * and total loss figures. Normalizes varying carrier formats to a standard schema.
 *
 * Updates the document record with extractedData JSON and sets status to ANALYZED.
 */
export async function extractLossRun(documentId: string): Promise<LossRunExtractedData> {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
  });

  try {
    const text = await extractPdfText(doc.s3Key);

    const metadata: Record<string, FieldConfidence> = {};

    // Extract all fields
    const carrierNameResult = extractCarrierName(text);
    const policyPeriodResult = extractPolicyPeriod(text);
    const claimsResult = extractClaims(text);

    // Normalize claims to standard schema
    const normalizedClaims = claimsResult ? normalizeClaims(claimsResult.value) : [];

    const totalClaimCountResult = extractTotalClaimCount(text, normalizedClaims.length);
    const totalIncurredResult = extractTotalIncurred(text, normalizedClaims);

    // Build metadata
    if (carrierNameResult) metadata.carrierName = carrierNameResult.confidence;
    if (policyPeriodResult) metadata.policyPeriod = policyPeriodResult.confidence;
    if (claimsResult) metadata.claims = claimsResult.confidence;
    if (totalClaimCountResult) metadata.totalClaimCount = totalClaimCountResult.confidence;
    if (totalIncurredResult) metadata.totalIncurred = totalIncurredResult.confidence;

    const extractedData: LossRunExtractedData = {
      carrierName: carrierNameResult?.value ?? null,
      policyPeriod: policyPeriodResult?.value ?? null,
      claims: normalizedClaims,
      totalClaimCount: totalClaimCountResult?.value ?? null,
      totalIncurred: totalIncurredResult?.value ?? null,
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
