import { prisma } from "@/lib/prisma";
import type { FraudIndicatorCategory, Severity } from "@/generated/prisma/client";

/** Weight per severity level for scoring */
const SEVERITY_WEIGHTS: Record<string, number> = {
  CRITICAL: 25,
  HIGH: 15,
  MEDIUM: 5,
  LOW: 1,
};

/** All fraud indicator categories for breakdown */
const ALL_CATEGORIES: FraudIndicatorCategory[] = [
  "CROSS_DOC",
  "FORENSIC",
  "STATISTICAL",
  "TEMPORAL",
  "RATIO",
  "ENTITY_INTEL",
  "VISUAL_AI",
  "NLP",
  "API_VERIFY",
  "RULES",
];

interface ScoreBreakdown {
  totalScore: number;
  severity: Severity;
  categoryCounts: Record<string, number>;
  categoryPoints: Record<string, number>;
  indicatorCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
}

/**
 * Calculates a composite fraud risk score (0-100) from all FraudIndicator records
 * for a submission, classifies severity, and updates the submission record.
 */
export async function calculateRiskScore(
  submissionId: string
): Promise<ScoreBreakdown> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
  });

  // Fetch all non-overridden fraud indicators for this submission
  const indicators = await prisma.fraudIndicator.findMany({
    where: {
      submissionId,
      tenantId: submission.tenantId,
      isOverridden: false,
    },
  });

  // If no indicators, submission is clean
  if (indicators.length === 0) {
    const breakdown: ScoreBreakdown = {
      totalScore: 0,
      severity: "CLEAN",
      categoryCounts: Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 0])),
      categoryPoints: Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 0])),
      indicatorCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        total: 0,
      },
    };

    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        riskScore: 0,
        severity: "CLEAN",
      },
    });

    return breakdown;
  }

  // Count indicators by severity
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;

  // Track points per category
  const categoryPoints: Record<string, number> = Object.fromEntries(
    ALL_CATEGORIES.map((c) => [c, 0])
  );
  const categoryCounts: Record<string, number> = Object.fromEntries(
    ALL_CATEGORIES.map((c) => [c, 0])
  );

  for (const indicator of indicators) {
    const weight = SEVERITY_WEIGHTS[indicator.severity] ?? 0;
    categoryPoints[indicator.category] =
      (categoryPoints[indicator.category] ?? 0) + weight;
    categoryCounts[indicator.category] =
      (categoryCounts[indicator.category] ?? 0) + 1;

    switch (indicator.severity) {
      case "CRITICAL":
        criticalCount++;
        break;
      case "HIGH":
        highCount++;
        break;
      case "MEDIUM":
        mediumCount++;
        break;
      case "LOW":
        lowCount++;
        break;
    }
  }

  // Calculate raw score
  const rawScore =
    criticalCount * SEVERITY_WEIGHTS.CRITICAL +
    highCount * SEVERITY_WEIGHTS.HIGH +
    mediumCount * SEVERITY_WEIGHTS.MEDIUM +
    lowCount * SEVERITY_WEIGHTS.LOW;

  // Cap at 100
  const totalScore = Math.min(rawScore, 100);

  // Classify severity
  let severity: Severity;
  if (totalScore > 85 || criticalCount > 0) {
    severity = "CRITICAL";
  } else if (totalScore >= 60) {
    severity = "HIGH";
  } else if (totalScore >= 35) {
    severity = "MEDIUM";
  } else {
    severity = "LOW";
  }

  const breakdown: ScoreBreakdown = {
    totalScore,
    severity,
    categoryCounts,
    categoryPoints,
    indicatorCounts: {
      critical: criticalCount,
      high: highCount,
      medium: mediumCount,
      low: lowCount,
      total: indicators.length,
    },
  };

  // Update submission with score and severity
  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      riskScore: totalScore,
      severity,
    },
  });

  return breakdown;
}
