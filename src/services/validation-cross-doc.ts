import { prisma } from "@/lib/prisma";
import { toJsonValue } from "@/lib/utils";
import type { Acord125ExtractedData } from "@/services/extraction-acord125";
import type { Acord130ExtractedData } from "@/services/extraction-acord130";
import type { Acord140ExtractedData } from "@/services/extraction-acord140";
import type { FinancialStatementExtractedData } from "@/services/extraction-financial-statement";
import type { LossRunExtractedData } from "@/services/extraction-loss-run";

// ─── Types ──────────────────────────────────────────────

interface PayrollTaxExtractedData {
  totalPayroll?: number | null;
  employeeCount?: number | null;
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
      evidence: toJsonValue(evidence),
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
      evidence: toJsonValue(evidence),
      confidence: 0.85,
      recommendedAction:
        severity === "CRITICAL"
          ? "Request payroll verification documents and investigate potential payroll misrepresentation"
          : "Review payroll discrepancy and request updated payroll documentation from the broker",
    },
  });
}

// ─── Employee Count Validation ──────────────────────────

/**
 * Compare employee count from ACORD 125/130 headcount vs payroll tax document count.
 *
 * - >2 difference → HIGH severity
 * - Skips gracefully if required documents are missing.
 */
export async function validateEmployeeCount(
  submissionId: string,
): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
  });

  // Try ACORD 125 first for numberOfEmployees
  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );

  // Try ACORD 130 for employee count from payroll classifications
  const acord130 = await findExtractedData<Acord130ExtractedData>(
    submissionId,
    "ACORD_130",
  );

  // Determine application-side employee count
  let applicationCount: number | null = null;
  let applicationSource: string = "";
  let applicationDocumentId: string = "";

  if (acord125?.data.numberOfEmployees != null) {
    applicationCount = acord125.data.numberOfEmployees;
    applicationSource = "ACORD 125";
    applicationDocumentId = acord125.documentId;
  } else if (acord130?.data.payrollByClassification?.length) {
    // Sum employee counts from payroll classifications
    const total = acord130.data.payrollByClassification.reduce(
      (sum, cls) => sum + (cls.employeeCount ?? 0),
      0,
    );
    if (total > 0) {
      applicationCount = total;
      applicationSource = "ACORD 130";
      applicationDocumentId = acord130.documentId;
    }
  }

  if (applicationCount == null) return;

  // Find payroll tax document for employee count
  const payrollTax = await findExtractedData<PayrollTaxExtractedData>(
    submissionId,
    "PAYROLL_TAX",
  );
  if (!payrollTax || payrollTax.data.employeeCount == null) return;

  const taxCount = payrollTax.data.employeeCount;
  const difference = Math.abs(applicationCount - taxCount);

  // Flag >2 difference as HIGH
  if (difference <= 2) return;

  const evidence = {
    applicationEmployeeCount: applicationCount,
    applicationSource,
    applicationDocumentId,
    payrollTaxEmployeeCount: taxCount,
    payrollTaxDocumentId: payrollTax.documentId,
    difference,
  };

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId: submission.tenantId,
      category: "CROSS_DOC",
      indicatorName: "EMPLOYEE_COUNT_MISMATCH",
      description: `Employee count on ${applicationSource} (${applicationCount}) differs from payroll tax document (${taxCount}) by ${difference}`,
      severity: "HIGH",
      evidence: toJsonValue(evidence),
      confidence: 0.8,
      recommendedAction:
        "Review employee count discrepancy and request updated employee records from the broker",
    },
  });
}

// ─── Loss History Validation ────────────────────────────

/**
 * Count claims in submitted loss runs vs count on ACORD 125 loss disclosure.
 *
 * - Any omitted claim → CRITICAL severity
 * - Skips gracefully if required documents are missing.
 */
export async function validateLossHistory(
  submissionId: string,
): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
  });

  // Find ACORD 125 for loss disclosure
  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );
  if (!acord125) return;

  // Find all loss run documents for the submission
  const lossRunDocs = await prisma.document.findMany({
    where: {
      submissionId,
      documentType: "LOSS_RUN",
      status: "ANALYZED",
    },
    orderBy: { createdAt: "desc" },
  });

  if (lossRunDocs.length === 0) return;

  // Aggregate claims from all loss runs
  let totalLossRunClaims = 0;
  const lossRunDocumentIds: string[] = [];

  for (const doc of lossRunDocs) {
    if (!doc.extractedData) continue;
    const data = doc.extractedData as unknown as LossRunExtractedData;
    const claimCount =
      data.totalClaimCount ?? (data.claims ? data.claims.length : 0);
    totalLossRunClaims += claimCount;
    lossRunDocumentIds.push(doc.id);
  }

  // Check 1: ACORD 125 says no losses (lossDisclosure = false) but loss runs show claims
  if (acord125.data.lossDisclosure === false && totalLossRunClaims > 0) {
    const evidence = {
      lossDisclosure: false,
      acordDocumentId: acord125.documentId,
      lossRunClaimCount: totalLossRunClaims,
      lossRunDocumentIds,
    };

    await prisma.fraudIndicator.create({
      data: {
        submissionId,
        tenantId: submission.tenantId,
        category: "CROSS_DOC",
        indicatorName: "LOSS_HISTORY_OMISSION",
        description: `ACORD 125 states no loss history, but loss runs contain ${totalLossRunClaims} claim(s)`,
        severity: "CRITICAL",
        evidence: toJsonValue(evidence),
        confidence: 0.9,
        recommendedAction:
          "Investigate potential concealment of loss history — applicant denied prior losses while loss runs show claims",
      },
    });
    return;
  }

  // Check 2: ACORD 125 discloses losses but count doesn't match loss runs
  // If lossDisclosure is true or null (unknown), compare counts if we can
  // The ACORD 125 doesn't have an explicit claim count field, but if they
  // disclosed losses (lossDisclosure = true) we trust the loss runs as the
  // complete record. If lossDisclosure is null, we skip (can't validate).
}

// ─── Property Values Validation ─────────────────────────

/**
 * ACORD 140 insured values vs tax assessor benchmark.
 *
 * Uses a configurable assessed-to-insured ratio:
 * - 2x assessed value → HIGH severity
 * - 3x assessed value → CRITICAL severity
 *
 * Since we don't have real tax assessor data, we use a heuristic estimate
 * based on the building value. The assessed-to-market ratio varies by
 * locality, but a common default is ~70% of market value for tax assessment.
 *
 * Skips gracefully if required documents are missing.
 */

const DEFAULT_ASSESSMENT_RATIO = 0.7; // Tax assessed value ≈ 70% of market value
const HIGH_THRESHOLD_MULTIPLIER = 2.0; // Insured > 2x assessed = HIGH
const CRITICAL_THRESHOLD_MULTIPLIER = 3.0; // Insured > 3x assessed = CRITICAL

export async function validatePropertyValues(
  submissionId: string,
): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
  });

  // Find ACORD 140 with property data
  const acord140 = await findExtractedData<Acord140ExtractedData>(
    submissionId,
    "ACORD_140",
  );
  if (!acord140 || !acord140.data.propertyLocations?.length) return;

  for (const location of acord140.data.propertyLocations) {
    const buildingValue = location.buildingValue;
    if (buildingValue == null || buildingValue <= 0) continue;

    // Estimate tax assessed value using the assessment ratio
    const estimatedAssessedValue = buildingValue * DEFAULT_ASSESSMENT_RATIO;

    // Total insured value for this location
    const totalInsured =
      (location.buildingValue ?? 0) +
      (location.contentsValue ?? 0) +
      (location.businessIncomeValue ?? 0);

    if (totalInsured <= 0) continue;

    const ratio = totalInsured / estimatedAssessedValue;

    if (ratio < HIGH_THRESHOLD_MULTIPLIER) continue;

    const severity =
      ratio >= CRITICAL_THRESHOLD_MULTIPLIER ? "CRITICAL" : "HIGH";

    const evidence = {
      propertyAddress: location.address,
      buildingValue: location.buildingValue,
      contentsValue: location.contentsValue,
      businessIncomeValue: location.businessIncomeValue,
      totalInsuredValue: totalInsured,
      estimatedAssessedValue: Math.round(estimatedAssessedValue),
      assessmentRatio: DEFAULT_ASSESSMENT_RATIO,
      insuredToAssessedRatio: Math.round(ratio * 100) / 100,
      acord140DocumentId: acord140.documentId,
    };

    await prisma.fraudIndicator.create({
      data: {
        submissionId,
        tenantId: submission.tenantId,
        documentId: acord140.documentId,
        category: "CROSS_DOC",
        indicatorName: "PROPERTY_VALUE_ANOMALY",
        description: `Property at ${location.address ?? "unknown address"}: total insured value ($${totalInsured.toLocaleString()}) is ${evidence.insuredToAssessedRatio}x the estimated assessed value ($${evidence.estimatedAssessedValue.toLocaleString()})`,
        severity,
        evidence: toJsonValue(evidence),
        confidence: 0.7,
        recommendedAction:
          severity === "CRITICAL"
            ? "Request property appraisal and verify insured values against tax assessor records — significant over-insurance detected"
            : "Review property insured values against tax assessor benchmarks — potential over-insurance",
      },
    });
  }
}
