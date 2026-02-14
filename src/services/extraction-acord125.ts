import { prisma } from "@/lib/prisma";
import { getFromS3 } from "@/lib/s3";

// ─── Extracted data types ────────────────────────────────

export interface Acord125ExtractedData {
  applicantName: string | null;
  businessName: string | null;
  dba: string | null;
  mailingAddress: string | null;
  physicalAddress: string | null;
  naicsCode: string | null;
  yearEstablished: string | null;
  annualRevenue: number | null;
  numberOfEmployees: number | null;
  priorCarrier: string | null;
  priorPolicyNumber: string | null;
  priorPremium: number | null;
  lossDisclosure: boolean | null;
  requestedCoverages: string[];
  effectiveDate: string | null;
  expirationDate: string | null;
  _metadata: Record<string, FieldConfidence>;
}

interface FieldConfidence {
  confidence: number;
  source: "regex" | "keyword" | "form-field";
}

// ─── Extraction patterns ─────────────────────────────────

/** Try multiple patterns for a field, return first match with the specified group. */
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

/** Extract a currency amount from text, removing $ and commas. */
function parseCurrency(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/** Extract an integer from text. */
function parseInteger(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

// ─── Field extraction functions ──────────────────────────

function extractApplicantName(text: string) {
  return extractField(text, [
    /APPLICANT\s*(?:NAME)?[:\s]*([A-Z][A-Za-z\s,.'-]{2,60})/i,
    /NAMED\s+INSURED[:\s]*([A-Z][A-Za-z\s,.'-]{2,60})/i,
    /INSURED\s*(?:NAME)?[:\s]*([A-Z][A-Za-z\s,.'-]{2,60})/i,
  ]);
}

function extractBusinessName(text: string) {
  return extractField(text, [
    /BUSINESS\s*(?:NAME|ENTITY)[:\s]*([A-Z][A-Za-z0-9\s,.&'-]{2,80})/i,
    /LEGAL\s*(?:NAME|ENTITY)[:\s]*([A-Z][A-Za-z0-9\s,.&'-]{2,80})/i,
    /COMPANY\s*NAME[:\s]*([A-Z][A-Za-z0-9\s,.&'-]{2,80})/i,
  ]);
}

function extractDBA(text: string) {
  return extractField(text, [
    /D\.?B\.?A\.?[:\s]*([A-Za-z0-9\s,.&'-]{2,80})/i,
    /DOING\s+BUSINESS\s+AS[:\s]*([A-Za-z0-9\s,.&'-]{2,80})/i,
    /TRADE\s+NAME[:\s]*([A-Za-z0-9\s,.&'-]{2,80})/i,
  ]);
}

function extractMailingAddress(text: string) {
  return extractField(text, [
    /MAILING\s+ADDRESS[:\s]*([A-Za-z0-9\s,.#'-]{5,120})/i,
    /MAIL(?:ING)?\s*ADDR(?:ESS)?[:\s]*([A-Za-z0-9\s,.#'-]{5,120})/i,
  ]);
}

function extractPhysicalAddress(text: string) {
  return extractField(text, [
    /PHYSICAL\s+ADDRESS[:\s]*([A-Za-z0-9\s,.#'-]{5,120})/i,
    /LOCATION\s+ADDRESS[:\s]*([A-Za-z0-9\s,.#'-]{5,120})/i,
    /PREMISES\s+ADDRESS[:\s]*([A-Za-z0-9\s,.#'-]{5,120})/i,
    /STREET\s+ADDRESS[:\s]*([A-Za-z0-9\s,.#'-]{5,120})/i,
  ]);
}

function extractNAICSCode(text: string) {
  return extractField(text, [
    /NAICS[:\s#]*(\d{4,6})/i,
    /NAICS\s+CODE[:\s]*(\d{4,6})/i,
    /INDUSTRY\s+CODE[:\s]*(\d{4,6})/i,
  ]);
}

function extractYearEstablished(text: string) {
  return extractField(text, [
    /YEAR\s+ESTABLISHED[:\s]*((?:19|20)\d{2})/i,
    /ESTABLISHED[:\s]*((?:19|20)\d{2})/i,
    /DATE\s+(?:OF\s+)?(?:ESTABLISHMENT|FOUNDED)[:\s]*((?:19|20)\d{2})/i,
    /(?:IN\s+BUSINESS\s+SINCE|SINCE)[:\s]*((?:19|20)\d{2})/i,
  ]);
}

function extractAnnualRevenue(
  text: string,
): { value: number; confidence: FieldConfidence } | null {
  const patterns = [
    /ANNUAL\s+REVENUE[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /GROSS\s+REVENUE[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /TOTAL\s+REVENUE[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /ANNUAL\s+SALES[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /GROSS\s+SALES[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const value = parseCurrency(match[1]);
      if (value !== null) {
        return {
          value,
          confidence: { confidence: 0.7, source: "regex" },
        };
      }
    }
  }
  return null;
}

function extractNumberOfEmployees(
  text: string,
): { value: number; confidence: FieldConfidence } | null {
  const patterns = [
    /(?:NUMBER|#|NO\.?)\s*(?:OF\s+)?EMPLOYEES[:\s]*([\d,]+)/i,
    /EMPLOYEE\s+COUNT[:\s]*([\d,]+)/i,
    /TOTAL\s+EMPLOYEES[:\s]*([\d,]+)/i,
    /FULL[\s-]TIME\s+EMPLOYEES[:\s]*([\d,]+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const value = parseInteger(match[1]);
      if (value !== null) {
        return {
          value,
          confidence: { confidence: 0.7, source: "regex" },
        };
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
    /PRESENT\s+CARRIER[:\s]*([A-Za-z\s,.&'-]{2,80})/i,
  ]);
}

function extractPriorPolicyNumber(text: string) {
  return extractField(text, [
    /PRIOR\s+POLICY\s*(?:NUMBER|#|NO\.?)[:\s]*([A-Za-z0-9-]{3,30})/i,
    /CURRENT\s+POLICY\s*(?:NUMBER|#|NO\.?)[:\s]*([A-Za-z0-9-]{3,30})/i,
    /EXPIRING\s+POLICY\s*(?:NUMBER|#|NO\.?)[:\s]*([A-Za-z0-9-]{3,30})/i,
    /POLICY\s*(?:NUMBER|#|NO\.?)[:\s]*([A-Za-z0-9-]{3,30})/i,
  ]);
}

function extractPriorPremium(
  text: string,
): { value: number; confidence: FieldConfidence } | null {
  const patterns = [
    /PRIOR\s+PREMIUM[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /CURRENT\s+PREMIUM[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /EXPIRING\s+PREMIUM[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /ANNUAL\s+PREMIUM[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const value = parseCurrency(match[1]);
      if (value !== null) {
        return {
          value,
          confidence: { confidence: 0.7, source: "regex" },
        };
      }
    }
  }
  return null;
}

function extractLossDisclosure(
  text: string,
): { value: boolean; confidence: FieldConfidence } | null {
  // Check for affirmative loss disclosure
  const yesPatterns = [
    /LOSS(?:ES)?\s+DISCLOSED[:\s]*YES/i,
    /ANY\s+LOSSES[:\s]*YES/i,
    /CLAIMS?\s+HISTORY[:\s]*YES/i,
    /PRIOR\s+LOSS(?:ES)?[:\s]*YES/i,
  ];
  for (const p of yesPatterns) {
    if (p.test(text)) {
      return { value: true, confidence: { confidence: 0.8, source: "regex" } };
    }
  }

  const noPatterns = [
    /LOSS(?:ES)?\s+DISCLOSED[:\s]*NO/i,
    /ANY\s+LOSSES[:\s]*NO(?:NE)?/i,
    /CLAIMS?\s+HISTORY[:\s]*NO(?:NE)?/i,
    /PRIOR\s+LOSS(?:ES)?[:\s]*NO(?:NE)?/i,
    /NO\s+(?:PRIOR\s+)?LOSS(?:ES)?/i,
  ];
  for (const p of noPatterns) {
    if (p.test(text)) {
      return { value: false, confidence: { confidence: 0.8, source: "regex" } };
    }
  }

  return null;
}

function extractRequestedCoverages(
  text: string,
): { value: string[]; confidence: FieldConfidence } | null {
  const coverageTypes = [
    "GENERAL LIABILITY",
    "COMMERCIAL GENERAL LIABILITY",
    "CGL",
    "PROPERTY",
    "COMMERCIAL PROPERTY",
    "WORKERS COMPENSATION",
    "WORKERS COMP",
    "AUTOMOBILE",
    "COMMERCIAL AUTO",
    "BUSINESS AUTO",
    "UMBRELLA",
    "EXCESS LIABILITY",
    "PROFESSIONAL LIABILITY",
    "ERRORS AND OMISSIONS",
    "E&O",
    "DIRECTORS AND OFFICERS",
    "D&O",
    "EMPLOYMENT PRACTICES",
    "EPLI",
    "CYBER",
    "INLAND MARINE",
    "OCEAN MARINE",
    "CRIME",
    "FIDELITY",
    "BUSINESS OWNERS",
    "BOP",
  ];

  const found: string[] = [];
  for (const coverage of coverageTypes) {
    const pattern = new RegExp(`\\b${coverage.replace(/[&]/g, "\\$&")}\\b`, "i");
    if (pattern.test(text)) {
      found.push(coverage);
    }
  }

  if (found.length > 0) {
    return {
      value: found,
      confidence: { confidence: 0.6, source: "keyword" },
    };
  }
  return null;
}

function extractDate(
  text: string,
  patterns: RegExp[],
): { value: string; confidence: FieldConfidence } | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      return {
        value: match[1].trim(),
        confidence: { confidence: 0.7, source: "regex" },
      };
    }
  }
  return null;
}

function extractEffectiveDate(text: string) {
  return extractDate(text, [
    /EFFECTIVE\s+DATE[:\s]*([\d/.-]+)/i,
    /PROPOSED\s+EFF(?:ECTIVE)?\s+DATE[:\s]*([\d/.-]+)/i,
    /POLICY\s+EFFECTIVE[:\s]*([\d/.-]+)/i,
    /EFF(?:ECTIVE)?[:\s]*([\d/.-]+)\s*(?:TO|THRU|-)/i,
  ]);
}

function extractExpirationDate(text: string) {
  return extractDate(text, [
    /EXPIR(?:ATION|ES?)?\s+DATE[:\s]*([\d/.-]+)/i,
    /(?:TO|THRU)[:\s]*([\d/.-]+)/i,
    /POLICY\s+EXPIR(?:ATION|ES?)[:\s]*([\d/.-]+)/i,
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
 * Extract structured fields from an ACORD 125 Commercial Insurance Application.
 *
 * Reads the PDF content from S3 and uses regex/pattern-based extraction
 * to identify key fields. Handles both text-based and form-field-based PDFs
 * (via text extraction from rendered form fields).
 *
 * Updates the document record with extractedData JSON and sets status to ANALYZED.
 */
export async function extractAcord125(documentId: string): Promise<Acord125ExtractedData> {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
  });

  try {
    const text = await extractPdfText(doc.s3Key);

    const metadata: Record<string, FieldConfidence> = {};

    // Extract all fields
    const applicantNameResult = extractApplicantName(text);
    const businessNameResult = extractBusinessName(text);
    const dbaResult = extractDBA(text);
    const mailingAddressResult = extractMailingAddress(text);
    const physicalAddressResult = extractPhysicalAddress(text);
    const naicsCodeResult = extractNAICSCode(text);
    const yearEstablishedResult = extractYearEstablished(text);
    const annualRevenueResult = extractAnnualRevenue(text);
    const numberOfEmployeesResult = extractNumberOfEmployees(text);
    const priorCarrierResult = extractPriorCarrier(text);
    const priorPolicyNumberResult = extractPriorPolicyNumber(text);
    const priorPremiumResult = extractPriorPremium(text);
    const lossDisclosureResult = extractLossDisclosure(text);
    const requestedCoveragesResult = extractRequestedCoverages(text);
    const effectiveDateResult = extractEffectiveDate(text);
    const expirationDateResult = extractExpirationDate(text);

    // Build metadata for each extracted field
    if (applicantNameResult) metadata.applicantName = applicantNameResult.confidence;
    if (businessNameResult) metadata.businessName = businessNameResult.confidence;
    if (dbaResult) metadata.dba = dbaResult.confidence;
    if (mailingAddressResult) metadata.mailingAddress = mailingAddressResult.confidence;
    if (physicalAddressResult) metadata.physicalAddress = physicalAddressResult.confidence;
    if (naicsCodeResult) metadata.naicsCode = naicsCodeResult.confidence;
    if (yearEstablishedResult) metadata.yearEstablished = yearEstablishedResult.confidence;
    if (annualRevenueResult) metadata.annualRevenue = annualRevenueResult.confidence;
    if (numberOfEmployeesResult) metadata.numberOfEmployees = numberOfEmployeesResult.confidence;
    if (priorCarrierResult) metadata.priorCarrier = priorCarrierResult.confidence;
    if (priorPolicyNumberResult) metadata.priorPolicyNumber = priorPolicyNumberResult.confidence;
    if (priorPremiumResult) metadata.priorPremium = priorPremiumResult.confidence;
    if (lossDisclosureResult) metadata.lossDisclosure = lossDisclosureResult.confidence;
    if (requestedCoveragesResult)
      metadata.requestedCoverages = requestedCoveragesResult.confidence;
    if (effectiveDateResult) metadata.effectiveDate = effectiveDateResult.confidence;
    if (expirationDateResult) metadata.expirationDate = expirationDateResult.confidence;

    const extractedData: Acord125ExtractedData = {
      applicantName: applicantNameResult?.value ?? null,
      businessName: businessNameResult?.value ?? null,
      dba: dbaResult?.value ?? null,
      mailingAddress: mailingAddressResult?.value ?? null,
      physicalAddress: physicalAddressResult?.value ?? null,
      naicsCode: naicsCodeResult?.value ?? null,
      yearEstablished: yearEstablishedResult?.value ?? null,
      annualRevenue: annualRevenueResult?.value ?? null,
      numberOfEmployees: numberOfEmployeesResult?.value ?? null,
      priorCarrier: priorCarrierResult?.value ?? null,
      priorPolicyNumber: priorPolicyNumberResult?.value ?? null,
      priorPremium: priorPremiumResult?.value ?? null,
      lossDisclosure: lossDisclosureResult?.value ?? null,
      requestedCoverages: requestedCoveragesResult?.value ?? [],
      effectiveDate: effectiveDateResult?.value ?? null,
      expirationDate: expirationDateResult?.value ?? null,
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
    // Set status to ERROR on failure
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "ERROR" },
    });
    throw error;
  }
}
