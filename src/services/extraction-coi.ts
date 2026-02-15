import { prisma } from "@/lib/prisma";
import { getFromS3 } from "@/lib/s3";
import { toJsonValue } from "@/lib/utils";

// ─── Extracted data types ────────────────────────────────

interface FieldConfidence {
  confidence: number;
  source: "regex" | "keyword" | "form-field";
}

export interface COIExtractedData {
  insuredName: string | null;
  insurerName: string | null;
  policyNumber: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  coverageTypes: string[];
  generalLiabilityLimit: number | null;
  autoLiabilityLimit: number | null;
  umbrellaLimit: number | null;
  workersCompLimit: number | null;
  agentName: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
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

function extractCurrencyField(
  text: string,
  patterns: RegExp[],
): { value: number; confidence: FieldConfidence } | null {
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

// ─── Field extraction functions ──────────────────────────

function extractInsuredName(text: string) {
  return extractField(text, [
    /INSURED\s*(?:NAME)?[:\s]*([A-Z][A-Za-z0-9\s,.&'-]{2,80})/i,
    /NAMED\s+INSURED[:\s]*([A-Z][A-Za-z0-9\s,.&'-]{2,80})/i,
    /CERTIFICATE\s+HOLDER[:\s]*([A-Z][A-Za-z0-9\s,.&'-]{2,80})/i,
    /THIS\s+(?:IS\s+TO\s+)?CERTIF(?:Y|IES)\s+(?:THAT\s+)?([A-Z][A-Za-z0-9\s,.&'-]{2,80})/i,
  ]);
}

function extractInsurerName(text: string) {
  return extractField(text, [
    /INSURER\s*(?:\(?A\)?)?[:\s]*([A-Z][A-Za-z\s,.&'-]{2,80})/i,
    /INSURANCE\s+COMPANY[:\s]*([A-Z][A-Za-z\s,.&'-]{2,80})/i,
    /CARRIER[:\s]*([A-Z][A-Za-z\s,.&'-]{2,80})/i,
    /UNDERWRITTEN\s+BY[:\s]*([A-Z][A-Za-z\s,.&'-]{2,80})/i,
    /COMPANY\s+NAME[:\s]*([A-Z][A-Za-z\s,.&'-]{2,80})/i,
  ]);
}

function extractPolicyNumber(text: string) {
  return extractField(text, [
    /POLICY\s*(?:NUMBER|#|NO\.?)[:\s]*([A-Za-z0-9][-A-Za-z0-9]{2,30})/i,
    /POLICY[:\s]*([A-Za-z0-9][-A-Za-z0-9]{2,30})/i,
    /POL(?:ICY)?\s*#[:\s]*([A-Za-z0-9][-A-Za-z0-9]{2,30})/i,
  ]);
}

function extractEffectiveDate(text: string) {
  return extractField(text, [
    /EFFECTIVE\s+DATE[:\s]*([\d/.-]+)/i,
    /EFF(?:ECTIVE)?[:\s]*([\d/.-]+)/i,
    /POLICY\s+EFF(?:ECTIVE)?[:\s]*([\d/.-]+)/i,
    /FROM[:\s]*([\d/.-]+)\s*(?:TO|THRU|-)/i,
  ]);
}

function extractExpirationDate(text: string) {
  return extractField(text, [
    /EXPIR(?:ATION|ES?)?\s+DATE[:\s]*([\d/.-]+)/i,
    /EXP(?:IRATION)?[:\s]*([\d/.-]+)/i,
    /POLICY\s+EXP(?:IRATION)?[:\s]*([\d/.-]+)/i,
    /(?:TO|THRU)[:\s]*([\d/.-]+)/i,
  ]);
}

function extractCoverageTypes(
  text: string,
): { value: string[]; confidence: FieldConfidence } | null {
  const coverageTypes = [
    "COMMERCIAL GENERAL LIABILITY",
    "GENERAL LIABILITY",
    "CGL",
    "AUTOMOBILE LIABILITY",
    "COMMERCIAL AUTO",
    "AUTO LIABILITY",
    "HIRED AUTOS",
    "NON-OWNED AUTOS",
    "UMBRELLA LIABILITY",
    "EXCESS LIABILITY",
    "UMBRELLA",
    "WORKERS COMPENSATION",
    "WORKERS COMP",
    "EMPLOYERS LIABILITY",
    "PROFESSIONAL LIABILITY",
    "ERRORS AND OMISSIONS",
    "E&O",
    "PRODUCTS/COMPLETED OPERATIONS",
    "PRODUCTS-COMP/OP",
    "PERSONAL & ADV INJURY",
    "PROPERTY DAMAGE",
    "BODILY INJURY",
    "INLAND MARINE",
    "COMMERCIAL PROPERTY",
  ];

  const found: string[] = [];
  for (const coverage of coverageTypes) {
    const pattern = new RegExp(`\\b${coverage.replace(/[&/]/g, "\\$&")}\\b`, "i");
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

function extractGeneralLiabilityLimit(text: string) {
  return extractCurrencyField(text, [
    /GENERAL\s+(?:LIABILITY|AGGREGATE)[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /CGL[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /EACH\s+OCCURRENCE[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /GEN(?:ERAL)?\s*(?:'?L|LIAB)[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
  ]);
}

function extractAutoLiabilityLimit(text: string) {
  return extractCurrencyField(text, [
    /AUTO(?:MOBILE)?\s+LIABILITY[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /COMBINED\s+SINGLE\s+LIMIT[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /AUTO\s+(?:EACH\s+)?(?:ACCIDENT|OCCURRENCE)[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /COMMERCIAL\s+AUTO[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
  ]);
}

function extractUmbrellaLimit(text: string) {
  return extractCurrencyField(text, [
    /UMBRELLA\s+(?:LIABILITY\s+)?(?:EACH\s+OCCURRENCE|LIMIT|AGGREGATE)?[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /EXCESS\s+(?:LIABILITY\s+)?(?:EACH\s+OCCURRENCE|LIMIT|AGGREGATE)?[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /UMBRELLA[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
  ]);
}

function extractWorkersCompLimit(text: string) {
  return extractCurrencyField(text, [
    /WORKERS\s+COMP(?:ENSATION)?[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /WC\s+STATUTORY\s+LIMITS?[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /E\.?L\.?\s+EACH\s+ACCIDENT[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /EMPLOYERS?\s+LIABILITY[:\s]*\$?([\d,]+(?:\.\d{1,2})?)/i,
  ]);
}

function extractAgentName(text: string) {
  return extractField(text, [
    /(?:AGENT|BROKER|PRODUCER)[:\s]*([A-Z][A-Za-z\s,.'-]{2,60})/i,
    /PRODUCER\s+(?:NAME)?[:\s]*([A-Z][A-Za-z\s,.'-]{2,60})/i,
    /AUTHORIZED\s+REPRESENTATIVE[:\s]*([A-Z][A-Za-z\s,.'-]{2,60})/i,
    /CONTACT\s+(?:NAME|PERSON)[:\s]*([A-Z][A-Za-z\s,.'-]{2,60})/i,
  ]);
}

function extractAgentEmail(text: string) {
  return extractField(text, [
    /E-?MAIL[:\s]*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i,
    /EMAIL\s+ADDRESS[:\s]*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i,
    /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i,
  ]);
}

function extractAgentPhone(text: string) {
  return extractField(text, [
    /PHONE[:\s]*\(?\s*(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i,
    /TEL(?:EPHONE)?[:\s]*(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i,
    /PH(?:ONE)?[:\s]*(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i,
    /FAX[:\s]*(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i,
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
 * Extract structured fields from a Certificate of Insurance (COI).
 *
 * Reads the PDF content from S3 and uses regex/pattern-based extraction
 * to identify insured/insurer names, policy details, coverage types,
 * liability limits, and agent contact information.
 *
 * Updates the document record with extractedData JSON and sets status to ANALYZED.
 */
export async function extractCOI(documentId: string): Promise<COIExtractedData> {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
  });

  try {
    const text = await extractPdfText(doc.s3Key);

    const metadata: Record<string, FieldConfidence> = {};

    // Extract all fields
    const insuredNameResult = extractInsuredName(text);
    const insurerNameResult = extractInsurerName(text);
    const policyNumberResult = extractPolicyNumber(text);
    const effectiveDateResult = extractEffectiveDate(text);
    const expirationDateResult = extractExpirationDate(text);
    const coverageTypesResult = extractCoverageTypes(text);
    const generalLiabilityLimitResult = extractGeneralLiabilityLimit(text);
    const autoLiabilityLimitResult = extractAutoLiabilityLimit(text);
    const umbrellaLimitResult = extractUmbrellaLimit(text);
    const workersCompLimitResult = extractWorkersCompLimit(text);
    const agentNameResult = extractAgentName(text);
    const agentEmailResult = extractAgentEmail(text);
    const agentPhoneResult = extractAgentPhone(text);

    // Build metadata
    if (insuredNameResult) metadata.insuredName = insuredNameResult.confidence;
    if (insurerNameResult) metadata.insurerName = insurerNameResult.confidence;
    if (policyNumberResult) metadata.policyNumber = policyNumberResult.confidence;
    if (effectiveDateResult) metadata.effectiveDate = effectiveDateResult.confidence;
    if (expirationDateResult) metadata.expirationDate = expirationDateResult.confidence;
    if (coverageTypesResult) metadata.coverageTypes = coverageTypesResult.confidence;
    if (generalLiabilityLimitResult)
      metadata.generalLiabilityLimit = generalLiabilityLimitResult.confidence;
    if (autoLiabilityLimitResult)
      metadata.autoLiabilityLimit = autoLiabilityLimitResult.confidence;
    if (umbrellaLimitResult) metadata.umbrellaLimit = umbrellaLimitResult.confidence;
    if (workersCompLimitResult) metadata.workersCompLimit = workersCompLimitResult.confidence;
    if (agentNameResult) metadata.agentName = agentNameResult.confidence;
    if (agentEmailResult) metadata.agentEmail = agentEmailResult.confidence;
    if (agentPhoneResult) metadata.agentPhone = agentPhoneResult.confidence;

    const extractedData: COIExtractedData = {
      insuredName: insuredNameResult?.value ?? null,
      insurerName: insurerNameResult?.value ?? null,
      policyNumber: policyNumberResult?.value ?? null,
      effectiveDate: effectiveDateResult?.value ?? null,
      expirationDate: expirationDateResult?.value ?? null,
      coverageTypes: coverageTypesResult?.value ?? [],
      generalLiabilityLimit: generalLiabilityLimitResult?.value ?? null,
      autoLiabilityLimit: autoLiabilityLimitResult?.value ?? null,
      umbrellaLimit: umbrellaLimitResult?.value ?? null,
      workersCompLimit: workersCompLimitResult?.value ?? null,
      agentName: agentNameResult?.value ?? null,
      agentEmail: agentEmailResult?.value ?? null,
      agentPhone: agentPhoneResult?.value ?? null,
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
