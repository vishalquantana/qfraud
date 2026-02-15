import { geminiStructuredAnalysis } from "@/lib/gemini";
import { createLogger } from "@/lib/logger";

const log = createLogger("extraction-ai");

// ─── Types ──────────────────────────────────────────────

export interface AIExtractionResult {
  /** The extracted data — structure depends on document type. */
  [key: string]: unknown;
  /** Metadata about the AI extraction. */
  _metadata: {
    source: "gemini-ai";
  };
}

// ─── Document-Type Prompts ──────────────────────────────

const ACORD_125_PROMPT = `You are an expert insurance document data extraction system. Extract the following structured fields from this ACORD 125 Commercial Insurance Application text.

Return ONLY a valid JSON object (no markdown, no explanation) with these fields:
{
  "applicantName": "string or null",
  "businessName": "string or null",
  "dba": "string or null",
  "mailingAddress": "string or null",
  "physicalAddress": "string or null",
  "naicsCode": "string or null",
  "yearEstablished": "string or null",
  "annualRevenue": "number or null (in dollars, no formatting)",
  "numberOfEmployees": "number or null",
  "priorCarrier": "string or null",
  "priorPolicyNumber": "string or null",
  "priorPremium": "number or null (in dollars)",
  "lossDisclosure": "boolean or null",
  "requestedCoverages": ["array of coverage type strings"],
  "effectiveDate": "string (YYYY-MM-DD) or null",
  "expirationDate": "string (YYYY-MM-DD) or null"
}

Set fields to null if they cannot be determined from the text.`;

const FINANCIAL_STATEMENT_PROMPT = `You are an expert financial document data extraction system. Extract the following structured fields from this financial statement text.

Return ONLY a valid JSON object (no markdown, no explanation) with these fields:
{
  "fiscalYear": "string or null",
  "revenue": "number or null (in dollars)",
  "costOfGoodsSold": "number or null",
  "grossProfit": "number or null",
  "operatingExpenses": "number or null",
  "netIncome": "number or null",
  "totalAssets": "number or null",
  "totalLiabilities": "number or null",
  "accountsReceivable": "number or null",
  "accountsPayable": "number or null"
}

Set fields to null if they cannot be determined from the text.`;

const LOSS_RUN_PROMPT = `You are an expert insurance document data extraction system. Extract the following structured fields from this loss run report text.

Return ONLY a valid JSON object (no markdown, no explanation) with these fields:
{
  "carrierName": "string or null",
  "policyPeriod": "string or null",
  "claims": [
    {
      "claimNumber": "string or null",
      "dateOfLoss": "string (YYYY-MM-DD) or null",
      "claimType": "string or null",
      "status": "string or null",
      "paidAmount": "number or null",
      "reserveAmount": "number or null",
      "totalIncurred": "number or null"
    }
  ],
  "totalClaimCount": "number or null",
  "totalIncurred": "number or null"
}

Set fields to null if they cannot be determined. Return an empty claims array if no claims are found.`;

const COI_PROMPT = `You are an expert insurance document data extraction system. Extract the following structured fields from this Certificate of Insurance (COI) text.

Return ONLY a valid JSON object (no markdown, no explanation) with these fields:
{
  "insuredName": "string or null",
  "insurerName": "string or null",
  "policyNumber": "string or null",
  "effectiveDate": "string (YYYY-MM-DD) or null",
  "expirationDate": "string (YYYY-MM-DD) or null",
  "coverageTypes": ["array of coverage type strings"],
  "generalLiabilityLimit": "number or null",
  "autoLiabilityLimit": "number or null",
  "umbrellaLimit": "number or null",
  "workersCompLimit": "number or null",
  "agentName": "string or null",
  "agentEmail": "string or null",
  "agentPhone": "string or null"
}

Set fields to null if they cannot be determined.`;

// ─── Extractor map ──────────────────────────────────────

const EXTRACTORS: Record<string, (text: string) => Promise<Record<string, unknown> | null>> = {
  ACORD_125: (text) => aiExtractAcord125(text),
  ACORD_130: (text) => aiExtractAcord125(text), // Similar form structure
  ACORD_140: (text) => aiExtractAcord125(text), // Similar form structure
  FINANCIAL_STATEMENT: (text) => aiExtractFinancialStatement(text),
  LOSS_RUN: (text) => aiExtractLossRun(text),
  COI: (text) => aiExtractCOI(text),
};

// ─── Public API ─────────────────────────────────────────

/**
 * Extract structured data from ACORD 125 document text using Gemini AI.
 */
export async function aiExtractAcord125(
  text: string,
): Promise<Record<string, unknown> | null> {
  return geminiStructuredAnalysis<Record<string, unknown>>(ACORD_125_PROMPT, text);
}

/**
 * Extract structured data from a financial statement using Gemini AI.
 */
export async function aiExtractFinancialStatement(
  text: string,
): Promise<Record<string, unknown> | null> {
  return geminiStructuredAnalysis<Record<string, unknown>>(FINANCIAL_STATEMENT_PROMPT, text);
}

/**
 * Extract structured data from a loss run report using Gemini AI.
 */
export async function aiExtractLossRun(
  text: string,
): Promise<Record<string, unknown> | null> {
  return geminiStructuredAnalysis<Record<string, unknown>>(LOSS_RUN_PROMPT, text);
}

/**
 * Extract structured data from a Certificate of Insurance using Gemini AI.
 */
export async function aiExtractCOI(
  text: string,
): Promise<Record<string, unknown> | null> {
  return geminiStructuredAnalysis<Record<string, unknown>>(COI_PROMPT, text);
}

/**
 * Route to the correct AI extractor based on document type.
 * Returns null for unsupported document types or when Gemini is unavailable.
 */
export async function aiExtractForDocumentType(
  documentType: string,
  text: string,
): Promise<AIExtractionResult | null> {
  const extractor = EXTRACTORS[documentType];
  if (!extractor) {
    log.warn({ documentType }, "no AI extractor for document type");
    return null;
  }

  const result = await extractor(text);
  if (!result) {
    return null;
  }

  return {
    ...result,
    _metadata: { source: "gemini-ai" },
  };
}
