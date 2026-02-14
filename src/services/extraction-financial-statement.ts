import { prisma } from "@/lib/prisma";
import { getFromS3 } from "@/lib/s3";

// ─── Extracted data types ────────────────────────────────

interface FieldConfidence {
  confidence: number;
  source: "regex" | "keyword" | "form-field";
}

export interface FinancialStatementExtractedData {
  fiscalYear: string | null;
  revenue: number | null;
  costOfGoodsSold: number | null;
  grossProfit: number | null;
  operatingExpenses: number | null;
  netIncome: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  accountsReceivable: number | null;
  accountsPayable: number | null;
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
  // Handle parentheses for negative numbers: (1,234.56) => -1234.56
  const isNegative = /^\(.*\)$/.test(raw.trim());
  const cleaned = raw.replace(/[$,\s()]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return isNegative ? -num : num;
}

// ─── Field extraction functions ──────────────────────────

function extractFiscalYear(text: string) {
  return extractField(text, [
    /FISCAL\s+YEAR[:\s]*((?:19|20)\d{2})/i,
    /(?:FOR\s+THE\s+)?YEAR\s+END(?:ED|ING)[:\s]*(?:\w+\s+\d{1,2},?\s*)?((?:19|20)\d{2})/i,
    /(?:FOR\s+THE\s+)?(?:PERIOD|YEAR)\s+END(?:ED|ING)[:\s]*([\d/.-]+)/i,
    /(?:AS\s+OF|DATED?)[:\s]*(?:\w+\s+\d{1,2},?\s*)?((?:19|20)\d{2})/i,
    /FY\s*((?:19|20)\d{2})/i,
    /((?:19|20)\d{2})\s+(?:ANNUAL|FINANCIAL)\s+(?:REPORT|STATEMENT)/i,
  ]);
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
        return { value, confidence: { confidence: 0.7, source: "regex" } };
      }
    }
  }
  return null;
}

function extractRevenue(text: string) {
  return extractCurrencyField(text, [
    /(?:TOTAL\s+)?REVENUE[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /(?:NET\s+)?SALES[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /(?:TOTAL\s+)?(?:NET\s+)?REVENUE[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /GROSS\s+REVENUE[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /TOTAL\s+SALES[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /(?:NET\s+)?REVENUE\s+(?:FROM\s+)?(?:OPERATIONS|SERVICES)[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
  ]);
}

function extractCostOfGoodsSold(text: string) {
  return extractCurrencyField(text, [
    /COST\s+OF\s+GOODS\s+SOLD[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /COGS[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /COST\s+OF\s+SALES[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /COST\s+OF\s+(?:REVENUE|SERVICES)[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /DIRECT\s+COSTS?[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
  ]);
}

function extractGrossProfit(text: string) {
  return extractCurrencyField(text, [
    /GROSS\s+PROFIT[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /GROSS\s+MARGIN[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /GROSS\s+INCOME[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
  ]);
}

function extractOperatingExpenses(text: string) {
  return extractCurrencyField(text, [
    /(?:TOTAL\s+)?OPERATING\s+EXPENSES[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /OPERATING\s+COSTS?[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /SG&?A\s+(?:EXPENSES?)?[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /SELLING,?\s*GENERAL\s*(?:AND|&)\s*ADMIN(?:ISTRATIVE)?[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /TOTAL\s+EXPENSES[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
  ]);
}

function extractNetIncome(text: string) {
  return extractCurrencyField(text, [
    /NET\s+INCOME[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /NET\s+(?:PROFIT|EARNINGS)[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /NET\s+INCOME\s+\(?LOSS\)?[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /(?:INCOME|EARNINGS)\s+(?:AFTER|BEFORE)\s+(?:TAX(?:ES)?|INCOME\s+TAX(?:ES)?)[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /BOTTOM\s+LINE[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
  ]);
}

function extractTotalAssets(text: string) {
  return extractCurrencyField(text, [
    /TOTAL\s+ASSETS[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /ASSETS[,:\s]+TOTAL[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
  ]);
}

function extractTotalLiabilities(text: string) {
  return extractCurrencyField(text, [
    /TOTAL\s+LIABILITIES[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /LIABILITIES[,:\s]+TOTAL[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /TOTAL\s+LIABILITIES\s+(?:AND|&)\s+(?:STOCKHOLDERS?'?\s+)?EQUITY[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
  ]);
}

function extractAccountsReceivable(text: string) {
  return extractCurrencyField(text, [
    /ACCOUNTS?\s+RECEIVABLE[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /A\/?R[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /TRADE\s+RECEIVABLE[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /(?:NET\s+)?RECEIVABLES?[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
  ]);
}

function extractAccountsPayable(text: string) {
  return extractCurrencyField(text, [
    /ACCOUNTS?\s+PAYABLE[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /A\/?P[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /TRADE\s+PAYABLE[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
    /(?:CURRENT\s+)?PAYABLES?[:\s]*\$?([\d,()]+(?:\.\d{1,2})?)/i,
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
 * Extract structured fields from a financial statement.
 *
 * Reads the PDF content from S3 and uses regex/pattern-based extraction
 * to identify income statement fields (revenue, COGS, profit, expenses, net income)
 * and balance sheet fields (assets, liabilities, A/R, A/P).
 *
 * Updates the document record with extractedData JSON and sets status to ANALYZED.
 */
export async function extractFinancialStatement(
  documentId: string,
): Promise<FinancialStatementExtractedData> {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
  });

  try {
    const text = await extractPdfText(doc.s3Key);

    const metadata: Record<string, FieldConfidence> = {};

    // Extract all fields
    const fiscalYearResult = extractFiscalYear(text);
    const revenueResult = extractRevenue(text);
    const cogsResult = extractCostOfGoodsSold(text);
    const grossProfitResult = extractGrossProfit(text);
    const operatingExpensesResult = extractOperatingExpenses(text);
    const netIncomeResult = extractNetIncome(text);
    const totalAssetsResult = extractTotalAssets(text);
    const totalLiabilitiesResult = extractTotalLiabilities(text);
    const accountsReceivableResult = extractAccountsReceivable(text);
    const accountsPayableResult = extractAccountsPayable(text);

    // Build metadata
    if (fiscalYearResult) metadata.fiscalYear = fiscalYearResult.confidence;
    if (revenueResult) metadata.revenue = revenueResult.confidence;
    if (cogsResult) metadata.costOfGoodsSold = cogsResult.confidence;
    if (grossProfitResult) metadata.grossProfit = grossProfitResult.confidence;
    if (operatingExpensesResult)
      metadata.operatingExpenses = operatingExpensesResult.confidence;
    if (netIncomeResult) metadata.netIncome = netIncomeResult.confidence;
    if (totalAssetsResult) metadata.totalAssets = totalAssetsResult.confidence;
    if (totalLiabilitiesResult)
      metadata.totalLiabilities = totalLiabilitiesResult.confidence;
    if (accountsReceivableResult)
      metadata.accountsReceivable = accountsReceivableResult.confidence;
    if (accountsPayableResult)
      metadata.accountsPayable = accountsPayableResult.confidence;

    const extractedData: FinancialStatementExtractedData = {
      fiscalYear: fiscalYearResult?.value ?? null,
      revenue: revenueResult?.value ?? null,
      costOfGoodsSold: cogsResult?.value ?? null,
      grossProfit: grossProfitResult?.value ?? null,
      operatingExpenses: operatingExpensesResult?.value ?? null,
      netIncome: netIncomeResult?.value ?? null,
      totalAssets: totalAssetsResult?.value ?? null,
      totalLiabilities: totalLiabilitiesResult?.value ?? null,
      accountsReceivable: accountsReceivableResult?.value ?? null,
      accountsPayable: accountsPayableResult?.value ?? null,
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
