import { prisma } from "@/lib/prisma";
import { toJsonValue } from "@/lib/utils";
import type { Acord125ExtractedData } from "@/services/extraction-acord125";
import type { Acord130ExtractedData } from "@/services/extraction-acord130";
import type { FinancialStatementExtractedData } from "@/services/extraction-financial-statement";
import { getBenchmark } from "@/services/industry-benchmarks";

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

/**
 * Check if a currency value is an exact multiple of $100,000.
 */
function isRoundHundredK(value: number): boolean {
  return value > 0 && value % 100000 === 0;
}

// ─── Round-number detection ─────────────────────────────

/**
 * Flag currency values that are exact multiples of $100K across
 * all extracted financial data (revenue, payroll, COGS, etc.).
 */
async function detectRoundNumbers(
  submissionId: string,
  tenantId: string,
): Promise<void> {
  const roundValues: Array<{
    field: string;
    value: number;
    source: string;
    documentId: string;
  }> = [];

  // Check ACORD 125 fields
  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );
  if (acord125) {
    const fields: Array<{ name: string; value: number | null }> = [
      { name: "annualRevenue", value: acord125.data.annualRevenue },
      { name: "priorPremium", value: acord125.data.priorPremium },
    ];
    for (const { name, value } of fields) {
      if (value != null && isRoundHundredK(value)) {
        roundValues.push({
          field: name,
          value,
          source: "ACORD 125",
          documentId: acord125.documentId,
        });
      }
    }
  }

  // Check ACORD 130 payroll
  const acord130 = await findExtractedData<Acord130ExtractedData>(
    submissionId,
    "ACORD_130",
  );
  if (acord130?.data.totalPayroll != null) {
    if (isRoundHundredK(acord130.data.totalPayroll)) {
      roundValues.push({
        field: "totalPayroll",
        value: acord130.data.totalPayroll,
        source: "ACORD 130",
        documentId: acord130.documentId,
      });
    }
  }

  // Check financial statement fields
  const financial = await findExtractedData<FinancialStatementExtractedData>(
    submissionId,
    "FINANCIAL_STATEMENT",
  );
  if (financial) {
    const fields: Array<{ name: string; value: number | null }> = [
      { name: "revenue", value: financial.data.revenue },
      { name: "costOfGoodsSold", value: financial.data.costOfGoodsSold },
      { name: "netIncome", value: financial.data.netIncome },
      { name: "totalAssets", value: financial.data.totalAssets },
      { name: "totalLiabilities", value: financial.data.totalLiabilities },
    ];
    for (const { name, value } of fields) {
      if (value != null && isRoundHundredK(value)) {
        roundValues.push({
          field: name,
          value,
          source: "Financial Statement",
          documentId: financial.documentId,
        });
      }
    }
  }

  if (roundValues.length === 0) return;

  const fieldSummary = roundValues
    .map((r) => `${r.field} ($${r.value.toLocaleString()}) from ${r.source}`)
    .join("; ");

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      category: "STATISTICAL",
      indicatorName: "ROUND_NUMBER_ANOMALY",
      description: `${roundValues.length} financial value(s) are exact multiples of $100K: ${fieldSummary}. Exact round numbers across multiple fields may indicate estimated or fabricated figures.`,
      severity: "MEDIUM",
      evidence: toJsonValue({ roundValues }),
      confidence: 0.5,
      recommendedAction:
        "Review the flagged financial values for reasonableness. Request supporting documentation for round-number figures.",
    },
  });
}

// ─── Revenue growth check ───────────────────────────────

/**
 * Flag YoY revenue growth >30% from financial statements.
 * Compares ACORD 125 annual revenue (current) vs financial statement revenue (prior year).
 */
async function detectRevenueGrowthAnomaly(
  submissionId: string,
  tenantId: string,
): Promise<void> {
  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );
  if (!acord125 || acord125.data.annualRevenue == null) return;

  const financial = await findExtractedData<FinancialStatementExtractedData>(
    submissionId,
    "FINANCIAL_STATEMENT",
  );
  if (!financial || financial.data.revenue == null) return;

  const currentRevenue = acord125.data.annualRevenue;
  const priorRevenue = financial.data.revenue;

  if (priorRevenue <= 0) return;

  const growthPercent = ((currentRevenue - priorRevenue) / priorRevenue) * 100;

  // Look up max growth threshold from NAICS benchmark
  const benchmark = getBenchmark(acord125.data.naicsCode);
  const threshold = benchmark.maxRevenueGrowthPercent;

  if (growthPercent <= threshold) return;

  const evidence = {
    currentRevenue,
    priorRevenue,
    growthPercent: Math.round(growthPercent * 100) / 100,
    threshold,
    naicsCode: acord125.data.naicsCode,
    sectorName: benchmark.sectorName,
    acordDocumentId: acord125.documentId,
    financialDocumentId: financial.documentId,
  };

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      category: "STATISTICAL",
      indicatorName: "REVENUE_GROWTH_ANOMALY",
      description: `Year-over-year revenue growth of ${evidence.growthPercent}% (from $${priorRevenue.toLocaleString()} to $${currentRevenue.toLocaleString()}) exceeds the ${threshold}% threshold for ${benchmark.sectorName}. Rapid revenue growth may indicate inflated figures.`,
      severity: "HIGH",
      evidence: toJsonValue(evidence),
      confidence: 0.7,
      recommendedAction:
        "Request audited financial statements and supporting documentation for the revenue increase. Verify business expansion claims.",
    },
  });
}

// ─── COGS margin check ──────────────────────────────────

/**
 * Flag COGS as % of revenue deviating >15% from industry norm
 * by NAICS code.
 */
async function detectCogsMarginAnomaly(
  submissionId: string,
  tenantId: string,
): Promise<void> {
  const financial = await findExtractedData<FinancialStatementExtractedData>(
    submissionId,
    "FINANCIAL_STATEMENT",
  );
  if (
    !financial ||
    financial.data.revenue == null ||
    financial.data.costOfGoodsSold == null
  )
    return;

  const revenue = financial.data.revenue;
  if (revenue <= 0) return;

  const cogs = financial.data.costOfGoodsSold;
  const cogsPercent = (cogs / revenue) * 100;

  // Get NAICS code from ACORD 125 for benchmark lookup
  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );
  const benchmark = getBenchmark(acord125?.data.naicsCode ?? null);

  const [expectedMin, expectedMax] = benchmark.cogsMarginRange;

  // Check if COGS % deviates more than 15 points from the expected range
  const deviationBelow = expectedMin - cogsPercent;
  const deviationAbove = cogsPercent - expectedMax;
  const deviation = Math.max(deviationBelow, deviationAbove);

  if (deviation <= 15) return;

  const evidence = {
    costOfGoodsSold: cogs,
    revenue,
    cogsPercent: Math.round(cogsPercent * 100) / 100,
    expectedRange: `${expectedMin}%-${expectedMax}%`,
    deviation: Math.round(deviation * 100) / 100,
    naicsCode: acord125?.data.naicsCode ?? null,
    sectorName: benchmark.sectorName,
    financialDocumentId: financial.documentId,
    acordDocumentId: acord125?.documentId ?? null,
  };

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      category: "STATISTICAL",
      indicatorName: "COGS_MARGIN_ANOMALY",
      description: `COGS as percentage of revenue (${evidence.cogsPercent}%) deviates significantly from the expected range (${evidence.expectedRange}) for ${benchmark.sectorName}. This ${cogsPercent < expectedMin ? "unusually low" : "unusually high"} cost structure may warrant investigation.`,
      severity: "HIGH",
      evidence: toJsonValue(evidence),
      confidence: 0.7,
      recommendedAction:
        "Review cost structure and verify COGS figures against supplier invoices or other supporting documentation.",
    },
  });
}

// ─── Payroll-per-head check ─────────────────────────────

/**
 * Flag per-employee payroll outside industry norms.
 * Uses ACORD 130 total payroll and employee count from ACORD 125 or 130.
 */
async function detectPayrollPerHeadAnomaly(
  submissionId: string,
  tenantId: string,
): Promise<void> {
  const acord130 = await findExtractedData<Acord130ExtractedData>(
    submissionId,
    "ACORD_130",
  );
  if (!acord130 || acord130.data.totalPayroll == null) return;

  const totalPayroll = acord130.data.totalPayroll;

  // Determine employee count from ACORD 125 or ACORD 130 classifications
  let employeeCount: number | null = null;
  let employeeSource = "";
  let employeeDocumentId = "";

  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );
  if (acord125?.data.numberOfEmployees != null) {
    employeeCount = acord125.data.numberOfEmployees;
    employeeSource = "ACORD 125";
    employeeDocumentId = acord125.documentId;
  } else if (acord130.data.payrollByClassification?.length) {
    const total = acord130.data.payrollByClassification.reduce(
      (sum, cls) => sum + (cls.employeeCount ?? 0),
      0,
    );
    if (total > 0) {
      employeeCount = total;
      employeeSource = "ACORD 130";
      employeeDocumentId = acord130.documentId;
    }
  }

  if (employeeCount == null || employeeCount <= 0) return;

  const payrollPerHead = totalPayroll / employeeCount;

  // Look up expected range from NAICS benchmark
  const benchmark = getBenchmark(acord125?.data.naicsCode ?? null);
  const [expectedMin, expectedMax] = benchmark.payrollPerHeadRange;

  if (payrollPerHead >= expectedMin && payrollPerHead <= expectedMax) return;

  const evidence = {
    totalPayroll,
    employeeCount,
    employeeSource,
    payrollPerHead: Math.round(payrollPerHead),
    expectedRange: `$${expectedMin.toLocaleString()}-$${expectedMax.toLocaleString()}`,
    naicsCode: acord125?.data.naicsCode ?? null,
    sectorName: benchmark.sectorName,
    acord130DocumentId: acord130.documentId,
    employeeDocumentId,
  };

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      category: "STATISTICAL",
      indicatorName: "PAYROLL_PER_HEAD_ANOMALY",
      description: `Average payroll per employee ($${Math.round(payrollPerHead).toLocaleString()}) is outside the expected range (${evidence.expectedRange}) for ${benchmark.sectorName}. ${payrollPerHead < expectedMin ? "Unusually low payroll may indicate underreported employees or payroll" : "Unusually high payroll may indicate inflated compensation figures"}.`,
      severity: "HIGH",
      evidence: toJsonValue(evidence),
      confidence: 0.7,
      recommendedAction:
        payrollPerHead < expectedMin
          ? "Verify employee count and payroll records. Low per-employee payroll may indicate misclassification or underreporting."
          : "Verify compensation structure. Unusually high per-employee payroll may indicate inflated figures or executive-heavy payroll.",
    },
  });
}

// ─── Main service ──────────────────────────────────────

/**
 * Run all statistical anomaly checks for a submission.
 *
 * Checks:
 * 1. Round-number detection: currency values that are exact multiples of $100K (MEDIUM)
 * 2. Revenue growth check: YoY revenue growth >30% (HIGH)
 * 3. COGS margin check: COGS as % of revenue deviating >15% from industry norm (HIGH)
 * 4. Payroll-per-head check: per-employee payroll outside industry norms (HIGH)
 *
 * Creates FraudIndicator records with category STATISTICAL.
 * Skips gracefully if required documents are missing.
 */
export async function detectStatisticalAnomalies(
  submissionId: string,
): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
  });

  const tenantId = submission.tenantId;

  await Promise.all([
    detectRoundNumbers(submissionId, tenantId),
    detectRevenueGrowthAnomaly(submissionId, tenantId),
    detectCogsMarginAnomaly(submissionId, tenantId),
    detectPayrollPerHeadAnomaly(submissionId, tenantId),
  ]);
}
