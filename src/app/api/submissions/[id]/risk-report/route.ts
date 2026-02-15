import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";
import type {
  FraudIndicatorCategory,
  Severity,
} from "@/generated/prisma/client";

// ─── Severity weights (same as scoring-engine.ts) ────────

const SEVERITY_WEIGHTS: Record<string, number> = {
  CRITICAL: 25,
  HIGH: 15,
  MEDIUM: 5,
  LOW: 1,
};

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

const CATEGORY_LABELS: Record<string, string> = {
  CROSS_DOC: "Cross-Document Validation",
  FORENSIC: "Document Forensics",
  STATISTICAL: "Statistical Anomaly",
  TEMPORAL: "Temporal Analysis",
  RATIO: "Financial Ratio Analysis",
  ENTITY_INTEL: "Entity Intelligence",
  VISUAL_AI: "Visual AI Analysis",
  NLP: "Natural Language Processing",
  API_VERIFY: "API Verification",
  RULES: "Rules Engine",
};

// ─── Explainability Text Generator ──────────────────────

function generateExplainability(
  indicators: Array<{
    severity: Severity;
    indicatorName: string;
    category: FraudIndicatorCategory;
    description: string;
  }>
): string {
  const critical = indicators.filter((i) => i.severity === "CRITICAL");
  const high = indicators.filter((i) => i.severity === "HIGH");

  if (critical.length === 0 && high.length === 0) {
    if (indicators.length === 0) {
      return "No fraud indicators were detected for this submission. All cross-document validations, statistical checks, and forensic analyses returned clean results.";
    }
    return `This submission has ${indicators.length} low-severity indicator(s) that may warrant a brief review but do not suggest significant fraud risk.`;
  }

  const parts: string[] = [];

  if (critical.length > 0) {
    const names = critical.map((i) => i.indicatorName).join(", ");
    parts.push(
      `CRITICAL: ${critical.length} critical issue(s) detected (${names}). These require immediate attention and may indicate document forgery, data fabrication, or regulatory violations.`
    );
  }

  if (high.length > 0) {
    const categories = [
      ...new Set(high.map((i) => CATEGORY_LABELS[i.category] ?? i.category)),
    ];
    parts.push(
      `HIGH: ${high.length} high-severity issue(s) across ${categories.join(", ")}. These indicate significant discrepancies that should be investigated before proceeding.`
    );
  }

  return parts.join(" ");
}

// ─── GET /api/submissions/:id/risk-report ────────────────

export const GET = withRole(
  [
    "ADMIN",
    "SENIOR_UNDERWRITER",
    "UNDERWRITER",
    "SIU_INVESTIGATOR",
    "COMPLIANCE_OFFICER",
  ],
  async (ctx, params) => {
    const { tenantId } = ctx;
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Submission ID required" },
        { status: 400 }
      );
    }

    // Fetch submission with full details
    const submission = await prisma.submission.findFirst({
      where: withTenantFilter(tenantId, { id }),
      select: {
        id: true,
        insuredName: true,
        lineOfBusiness: true,
        status: true,
        riskScore: true,
        severity: true,
        channel: true,
        createdAt: true,
        submitter: { select: { id: true, name: true, email: true } },
        assignedUnderwriter: { select: { id: true, name: true, email: true } },
      },
    });

    if (!submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }

    // Fetch all fraud indicators (including overridden for UI display)
    const indicators = await prisma.fraudIndicator.findMany({
      where: withTenantFilter(tenantId, {
        submissionId: id,
      }),
      include: {
        document: { select: { id: true, fileName: true, documentType: true } },
        overriddenBy: { select: { id: true, name: true } },
      },
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
    });

    // Use only non-overridden indicators for score breakdown and counts
    const activeIndicators = indicators.filter((i) => !i.isOverridden);

    // Calculate score breakdown by category
    const categoryBreakdown = ALL_CATEGORIES.map((cat) => {
      const catIndicators = activeIndicators.filter((i) => i.category === cat);
      const points = catIndicators.reduce(
        (sum, i) => sum + (SEVERITY_WEIGHTS[i.severity] ?? 0),
        0
      );
      return {
        category: cat,
        label: CATEGORY_LABELS[cat] ?? cat,
        count: catIndicators.length,
        points,
      };
    }).filter((c) => c.count > 0);

    // Count by severity (active only)
    const indicatorCounts = {
      critical: activeIndicators.filter((i) => i.severity === "CRITICAL").length,
      high: activeIndicators.filter((i) => i.severity === "HIGH").length,
      medium: activeIndicators.filter((i) => i.severity === "MEDIUM").length,
      low: activeIndicators.filter((i) => i.severity === "LOW").length,
      total: activeIndicators.length,
    };

    // Generate explainability text (active only)
    const explainability = generateExplainability(activeIndicators);

    // Check for prior submissions from same entity/broker
    const priorSubmissions = await prisma.submission.findMany({
      where: withTenantFilter(tenantId, {
        insuredName: submission.insuredName,
        id: { not: id },
      }),
      select: {
        id: true,
        insuredName: true,
        status: true,
        riskScore: true,
        severity: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    return NextResponse.json({
      data: {
        submission: {
          id: submission.id,
          insuredName: submission.insuredName,
          lineOfBusiness: submission.lineOfBusiness,
          status: submission.status,
          channel: submission.channel,
          createdAt: submission.createdAt,
          submitter: submission.submitter,
          assignedUnderwriter: submission.assignedUnderwriter,
        },
        riskScore: submission.riskScore ?? 0,
        severity: submission.severity ?? "CLEAN",
        categoryBreakdown,
        indicatorCounts,
        indicators: indicators.map((i) => ({
          id: i.id,
          category: i.category,
          categoryLabel: CATEGORY_LABELS[i.category] ?? i.category,
          indicatorName: i.indicatorName,
          description: i.description,
          severity: i.severity,
          evidence: i.evidence,
          confidence: i.confidence,
          recommendedAction: i.recommendedAction,
          isOverridden: i.isOverridden,
          overriddenBy: i.overriddenBy,
          overrideJustification: i.overrideJustification,
          document: i.document,
          createdAt: i.createdAt,
        })),
        explainability,
        priorSubmissions,
      },
    });
  }
);
