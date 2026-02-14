import { prisma } from "@/lib/prisma";
import type { Acord125ExtractedData } from "@/services/extraction-acord125";
import type { Acord130ExtractedData } from "@/services/extraction-acord130";
import type { FinancialStatementExtractedData } from "@/services/extraction-financial-statement";

// ─── Types ──────────────────────────────────────────────

interface PayrollTaxExtractedData {
  totalPayroll?: number | null;
  [key: string]: unknown;
}

// ─── Helpers ────────────────────────────────────────────

/**
 * Find the first ANALYZED document of a given type for a submission
 * and return its extractedData parsed as T.
 */
async function findExtractedData<T>(
  submissionId: string,
  documentType: string,
): Promise<{ data: T; documentId: string } | null> {
  const doc = await prisma.document.findFirst({
    where: {
      submissionId,
      documentType: documentType as never,
      status: "ANALYZED",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!doc || !doc.extractedData) return null;

  return {
    data: doc.extractedData as unknown as T,
    documentId: doc.id,
  };
}

// ─── Revenue Validation ─────────────────────────────────

/**
 * Compare revenue from ACORD 125 (annualRevenue) vs financial statement (revenue).
 *
 * - >15% variance → HIGH severity
 * - >25% variance → CRITICAL severity
 * - Skips gracefully if either document is missing.
 */
export async function validateRevenue(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
  });

  // Find ACORD 125 with extracted data
  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );
  if (!acord125 || acord125.data.annualRevenue == null) return;

  // Find financial statement with extracted data
  const financialStatement =
    await findExtractedData<FinancialStatementExtractedData>(
      submissionId,
      "FINANCIAL_STATEMENT",
    );
  if (!financialStatement || financialStatement.data.revenue == null) return;

  const acordRevenue = acord125.data.annualRevenue;
  const financialRevenue = financialStatement.data.revenue;

  // Calculate variance as a percentage of the larger value
  const maxVal = Math.max(Math.abs(acordRevenue), Math.abs(financialRevenue));
  if (maxVal === 0) return;

  const difference = Math.abs(acordRevenue - financialRevenue);
  const variancePercent = (difference / maxVal) * 100;

  // Only flag if variance exceeds 15%
  if (variancePercent <= 15) return;

  const severity = variancePercent > 25 ? "CRITICAL" : "HIGH";

  const evidence = {
    acordRevenue,
    financialStatementRevenue: financialRevenue,
    difference,
    variancePercent: Math.round(variancePercent * 100) / 100,
    acordDocumentId: acord125.documentId,
    financialStatementDocumentId: financialStatement.documentId,
  };

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId: submission.tenantId,
      category: "CROSS_DOC",
      indicatorName: "REVENUE_MISMATCH",
      description: `Revenue reported on ACORD 125 ($${acordRevenue.toLocaleString()}) differs from financial statement ($${financialRevenue.toLocaleString()}) by ${evidence.variancePercent}%`,
      severity,
      evidence: JSON.parse(JSON.stringify(evidence)),
      confidence: 0.85,
      recommendedAction:
        severity === "CRITICAL"
          ? "Request updated financial statements and verify revenue figures with the applicant"
          : "Review revenue discrepancy and request clarification from the broker",
    },
  });
}

// ─── Payroll Validation ─────────────────────────────────

/**
 * Compare total payroll from ACORD 130 vs payroll/tax document.
 *
 * - >$2,000 absolute variance → HIGH severity
 * - >10% variance → CRITICAL severity
 * - Skips gracefully if either document is missing.
 */
export async function validatePayroll(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
  });

  // Find ACORD 130 with extracted data
  const acord130 = await findExtractedData<Acord130ExtractedData>(
    submissionId,
    "ACORD_130",
  );
  if (!acord130 || acord130.data.totalPayroll == null) return;

  // Find payroll tax document with extracted data
  const payrollTax = await findExtractedData<PayrollTaxExtractedData>(
    submissionId,
    "PAYROLL_TAX",
  );
  if (!payrollTax || payrollTax.data.totalPayroll == null) return;

  const acordPayroll = acord130.data.totalPayroll;
  const taxPayroll = payrollTax.data.totalPayroll!;

  const difference = Math.abs(acordPayroll - taxPayroll);

  // Calculate percentage variance against the larger value
  const maxVal = Math.max(Math.abs(acordPayroll), Math.abs(taxPayroll));
  const variancePercent = maxVal > 0 ? (difference / maxVal) * 100 : 0;

  // Flag >$2,000 as HIGH, >10% as CRITICAL
  if (difference <= 2000) return;

  const severity = variancePercent > 10 ? "CRITICAL" : "HIGH";

  const evidence = {
    acordPayroll,
    taxDocumentPayroll: taxPayroll,
    difference,
    variancePercent: Math.round(variancePercent * 100) / 100,
    acordDocumentId: acord130.documentId,
    payrollTaxDocumentId: payrollTax.documentId,
  };

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId: submission.tenantId,
      category: "CROSS_DOC",
      indicatorName: "PAYROLL_MISMATCH",
      description: `Total payroll on ACORD 130 ($${acordPayroll.toLocaleString()}) differs from payroll tax document ($${taxPayroll.toLocaleString()}) by $${difference.toLocaleString()} (${evidence.variancePercent}%)`,
      severity,
      evidence: JSON.parse(JSON.stringify(evidence)),
      confidence: 0.85,
      recommendedAction:
        severity === "CRITICAL"
          ? "Request payroll verification documents and investigate potential payroll misrepresentation"
          : "Review payroll discrepancy and request updated payroll documentation from the broker",
    },
  });
}
