import { prisma } from "@/lib/prisma";
import { toJsonValue } from "@/lib/utils";
import type { Acord125ExtractedData } from "@/services/extraction-acord125";
import type { Acord140ExtractedData } from "@/services/extraction-acord140";
import type { FinancialStatementExtractedData } from "@/services/extraction-financial-statement";

// ─── Helpers ────────────────────────────────────────────

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

// ─── Contents-to-building ratio ranges by classification ─

/**
 * Expected contents-to-building value ratios by occupancy classification.
 * Expressed as [min, max] percentages.
 */
const CONTENTS_TO_BUILDING_RANGES: Record<string, [number, number]> = {
  retail: [20, 40],
  manufacturing: [30, 60],
  office: [10, 30],
  warehouse: [15, 50],
  restaurant: [20, 45],
};

const DEFAULT_CONTENTS_TO_BUILDING_RANGE: [number, number] = [15, 50];

/**
 * Classify an occupancy string into one of the known categories.
 */
function classifyOccupancy(occupancy: string | null): string {
  if (!occupancy) return "unknown";
  const lower = occupancy.toLowerCase();

  if (/retail|store|shop|mercantile|sales/.test(lower)) return "retail";
  if (/manufactur|factory|production|industrial|assembly/.test(lower))
    return "manufacturing";
  if (/office|professional|clerical/.test(lower)) return "office";
  if (/warehouse|storage|distribution/.test(lower)) return "warehouse";
  if (/restaurant|food.?service|dining|cafe|kitchen/.test(lower))
    return "restaurant";

  return "unknown";
}

// ─── Industry profit margin benchmarks ──────────────────

/**
 * Average net profit margins by NAICS sector code.
 * Used for profit margin anomaly detection.
 */
const INDUSTRY_PROFIT_MARGINS: Record<string, number> = {
  "11": 8, // Agriculture
  "21": 12, // Mining
  "22": 10, // Utilities
  "23": 5, // Construction
  "31": 7, // Manufacturing
  "32": 8, // Manufacturing
  "33": 8, // Manufacturing
  "42": 4, // Wholesale Trade
  "44": 4, // Retail Trade
  "45": 5, // Retail Trade
  "48": 5, // Transportation
  "49": 5, // Transportation
  "51": 12, // Information
  "52": 15, // Finance & Insurance
  "53": 20, // Real Estate
  "54": 12, // Professional Services
  "55": 15, // Management
  "56": 6, // Administrative
  "61": 8, // Education
  "62": 6, // Health Care
  "71": 8, // Arts & Entertainment
  "72": 6, // Accommodation & Food
  "81": 7, // Other Services
  "92": 5, // Public Admin
};

const DEFAULT_PROFIT_MARGIN = 8;

function getIndustryProfitMargin(naicsCode: string | null): {
  margin: number;
  sectorName: string;
} {
  if (!naicsCode || naicsCode.length < 2)
    return { margin: DEFAULT_PROFIT_MARGIN, sectorName: "Unknown / Default" };
  const sector = naicsCode.substring(0, 2);
  const margin = INDUSTRY_PROFIT_MARGINS[sector] ?? DEFAULT_PROFIT_MARGIN;
  const sectorName = sector in INDUSTRY_PROFIT_MARGINS ? `NAICS ${sector}` : "Unknown / Default";
  return { margin, sectorName };
}

// ─── DSO check ──────────────────────────────────────────

/**
 * Flag Days Sales Outstanding growing >20% while revenue increases.
 *
 * DSO = (Accounts Receivable / Revenue) * 365
 * Growing DSO alongside growing revenue is a classic sign of
 * fictitious revenue (booking revenue without actual collection).
 *
 * Uses ACORD 125 revenue as "current" and financial statement as "prior year".
 */
async function detectDSOAnomaly(
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
    financial.data.accountsReceivable == null
  )
    return;

  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );
  if (!acord125 || acord125.data.annualRevenue == null) return;

  const priorRevenue = financial.data.revenue;
  const currentRevenue = acord125.data.annualRevenue;
  const priorAR = financial.data.accountsReceivable;

  if (priorRevenue <= 0 || currentRevenue <= 0) return;

  // We only have prior-year A/R from financial statement.
  // Calculate prior DSO and compare to a synthetic "current DSO" estimate.
  // If revenue grew but A/R is already disproportionately high relative
  // to revenue, that's the signal.
  const priorDSO = (priorAR / priorRevenue) * 365;

  // Estimate current A/R based on same ratio growth pattern
  // If revenue is growing and DSO is already high (>60 days), flag it.
  // The stronger signal: A/R as % of revenue is already concerning
  // AND revenue is increasing.
  const revenueGrowth =
    ((currentRevenue - priorRevenue) / priorRevenue) * 100;

  // If revenue isn't increasing, DSO growth isn't as concerning
  if (revenueGrowth <= 0) return;

  // Calculate A/R ratio thresholds
  const arRatio = (priorAR / priorRevenue) * 100;

  // If DSO >20% above 45-day norm AND revenue is growing, flag it
  const normalDSO = 45; // Industry-standard baseline
  const dsoGrowthPercent = ((priorDSO - normalDSO) / normalDSO) * 100;

  if (dsoGrowthPercent <= 20) return;

  const evidence = {
    priorRevenue,
    currentRevenue,
    revenueGrowthPercent: Math.round(revenueGrowth * 100) / 100,
    accountsReceivable: priorAR,
    dso: Math.round(priorDSO * 100) / 100,
    arAsPercentOfRevenue: Math.round(arRatio * 100) / 100,
    dsoExcessPercent: Math.round(dsoGrowthPercent * 100) / 100,
    financialDocumentId: financial.documentId,
    acordDocumentId: acord125.documentId,
  };

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      category: "RATIO",
      indicatorName: "DSO_REVENUE_ANOMALY",
      description: `Days Sales Outstanding (${evidence.dso} days) is ${evidence.dsoExcessPercent}% above the 45-day norm while revenue grew ${evidence.revenueGrowthPercent}%. High DSO with growing revenue is a key indicator of fictitious revenue (booking sales without collection).`,
      severity: "CRITICAL",
      evidence: toJsonValue(evidence),
      confidence: 0.8,
      recommendedAction:
        "Investigate revenue recognition practices. Request aging schedule of accounts receivable and verify cash collection records.",
    },
  });
}

// ─── A/R ratio check ────────────────────────────────────

/**
 * Flag Accounts Receivable >40% of revenue.
 * High A/R-to-revenue ratio suggests slow collection or fictitious receivables.
 */
async function detectARRatioAnomaly(
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
    financial.data.accountsReceivable == null
  )
    return;

  const revenue = financial.data.revenue;
  const ar = financial.data.accountsReceivable;

  if (revenue <= 0) return;

  const arRatio = (ar / revenue) * 100;

  if (arRatio <= 40) return;

  const evidence = {
    accountsReceivable: ar,
    revenue,
    arAsPercentOfRevenue: Math.round(arRatio * 100) / 100,
    threshold: 40,
    financialDocumentId: financial.documentId,
  };

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      category: "RATIO",
      indicatorName: "AR_RATIO_ANOMALY",
      description: `Accounts Receivable ($${ar.toLocaleString()}) represents ${evidence.arAsPercentOfRevenue}% of revenue ($${revenue.toLocaleString()}), exceeding the 40% threshold. This may indicate slow collection, fictitious receivables, or inflated revenue.`,
      severity: "HIGH",
      evidence: toJsonValue(evidence),
      confidence: 0.75,
      recommendedAction:
        "Request accounts receivable aging report. Verify that receivables are collectible and not used to inflate revenue.",
    },
  });
}

// ─── Profit margin check ────────────────────────────────

/**
 * Flag net profit margin exceeding industry average by >50%.
 * Example: if industry avg is 10%, flag margins >15% (10 * 1.5).
 */
async function detectProfitMarginAnomaly(
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
    financial.data.netIncome == null
  )
    return;

  const revenue = financial.data.revenue;
  const netIncome = financial.data.netIncome;

  if (revenue <= 0) return;

  const profitMargin = (netIncome / revenue) * 100;

  // Look up NAICS code for industry benchmark
  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );
  const { margin: industryAvg, sectorName } = getIndustryProfitMargin(
    acord125?.data.naicsCode ?? null,
  );

  // Flag if margin exceeds industry average by >50%
  const threshold = industryAvg * 1.5;

  if (profitMargin <= threshold) return;

  const evidence = {
    revenue,
    netIncome,
    profitMarginPercent: Math.round(profitMargin * 100) / 100,
    industryAveragePercent: industryAvg,
    threshold: Math.round(threshold * 100) / 100,
    excessPercent:
      Math.round(((profitMargin - industryAvg) / industryAvg) * 100 * 100) /
      100,
    naicsCode: acord125?.data.naicsCode ?? null,
    sectorName,
    financialDocumentId: financial.documentId,
    acordDocumentId: acord125?.documentId ?? null,
  };

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      category: "RATIO",
      indicatorName: "PROFIT_MARGIN_ANOMALY",
      description: `Net profit margin (${evidence.profitMarginPercent}%) exceeds industry average (${industryAvg}%) for ${sectorName} by more than 50%. Unusually high margins may indicate understated expenses or inflated revenue.`,
      severity: "MEDIUM",
      evidence: toJsonValue(evidence),
      confidence: 0.65,
      recommendedAction:
        "Review expense categories for completeness. Verify that all costs of operations are properly accounted for.",
    },
  });
}

// ─── Contents-to-building ratio check ───────────────────

/**
 * Flag contents-to-building value ratio outside expected range for classification.
 * Expected ranges: retail 20-40%, manufacturing 30-60%.
 */
async function detectContentsToBuildingAnomaly(
  submissionId: string,
  tenantId: string,
): Promise<void> {
  const acord140 = await findExtractedData<Acord140ExtractedData>(
    submissionId,
    "ACORD_140",
  );
  if (!acord140 || !acord140.data.propertyLocations?.length) return;

  for (const location of acord140.data.propertyLocations) {
    const buildingValue = location.buildingValue;
    const contentsValue = location.contentsValue;

    if (
      buildingValue == null ||
      buildingValue <= 0 ||
      contentsValue == null ||
      contentsValue <= 0
    )
      continue;

    const ratio = (contentsValue / buildingValue) * 100;

    const classification = classifyOccupancy(location.occupancy);
    const [expectedMin, expectedMax] =
      CONTENTS_TO_BUILDING_RANGES[classification] ??
      DEFAULT_CONTENTS_TO_BUILDING_RANGE;

    // Only flag if outside expected range
    if (ratio >= expectedMin && ratio <= expectedMax) continue;

    const evidence = {
      propertyAddress: location.address,
      buildingValue,
      contentsValue,
      contentsToBuildingRatio: Math.round(ratio * 100) / 100,
      occupancy: location.occupancy,
      classification,
      expectedRange: `${expectedMin}%-${expectedMax}%`,
      acord140DocumentId: acord140.documentId,
    };

    await prisma.fraudIndicator.create({
      data: {
        submissionId,
        tenantId,
        documentId: acord140.documentId,
        category: "RATIO",
        indicatorName: "CONTENTS_TO_BUILDING_RATIO_ANOMALY",
        description: `Property at ${location.address ?? "unknown address"}: contents-to-building ratio (${evidence.contentsToBuildingRatio}%) is outside the expected range (${evidence.expectedRange}) for ${classification} occupancy. ${ratio < expectedMin ? "Unusually low contents value may indicate underinsurance" : "Unusually high contents value may indicate over-insurance for fraudulent claims"}.`,
        severity: "HIGH",
        evidence: toJsonValue(evidence),
        confidence: 0.7,
        recommendedAction:
          ratio > expectedMax
            ? "Request detailed contents inventory and verify values against replacement cost estimates."
            : "Verify contents coverage is adequate for the occupancy type. Low ratio may indicate underreporting.",
      },
    });
  }
}

// ─── Main service ──────────────────────────────────────

/**
 * Analyze financial ratios for a submission and flag anomalies.
 *
 * Checks:
 * 1. DSO calculation: flag DSO growing >20% while revenue increases (CRITICAL)
 * 2. A/R ratio: flag Accounts Receivable >40% of revenue (HIGH)
 * 3. Profit margin: flag net profit margin exceeding industry avg by >50% (MEDIUM)
 * 4. Contents-to-building ratio: flag if outside expected range for classification (HIGH)
 *
 * Creates FraudIndicator records with category RATIO.
 * Skips gracefully if required documents are missing.
 */
export async function analyzeFinancialRatios(
  submissionId: string,
): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
  });

  const tenantId = submission.tenantId;

  await Promise.all([
    detectDSOAnomaly(submissionId, tenantId),
    detectARRatioAnomaly(submissionId, tenantId),
    detectProfitMarginAnomaly(submissionId, tenantId),
    detectContentsToBuildingAnomaly(submissionId, tenantId),
  ]);
}
