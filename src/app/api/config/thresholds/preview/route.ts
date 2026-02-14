import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";

// ─── GET /api/config/thresholds/preview ──────────────────
// Accepts proposed thresholds and returns how the last 30 days
// of submissions would have been routed differently.

export const GET = withRole(["ADMIN"], async (ctx) => {
  const { req, tenantId } = ctx;
  const url = new URL(req.url);

  // Parse proposed thresholds from query params
  const proposedApproveBelow = parseInt(
    url.searchParams.get("autoApproveBelow") ?? "",
    10
  );
  const proposedEscalateAbove = parseInt(
    url.searchParams.get("autoEscalateAbove") ?? "",
    10
  );
  const proposedSiuReferral =
    url.searchParams.get("siuReferralOnCritical") !== "false";

  if (isNaN(proposedApproveBelow) || isNaN(proposedEscalateAbove)) {
    return NextResponse.json(
      {
        error:
          "autoApproveBelow and autoEscalateAbove query parameters are required (numbers)",
      },
      { status: 400 }
    );
  }

  if (proposedApproveBelow < 0 || proposedApproveBelow > 100) {
    return NextResponse.json(
      { error: "autoApproveBelow must be between 0 and 100" },
      { status: 400 }
    );
  }

  if (proposedEscalateAbove < 0 || proposedEscalateAbove > 100) {
    return NextResponse.json(
      { error: "autoEscalateAbove must be between 0 and 100" },
      { status: 400 }
    );
  }

  if (proposedApproveBelow >= proposedEscalateAbove) {
    return NextResponse.json(
      { error: "autoApproveBelow must be less than autoEscalateAbove" },
      { status: 400 }
    );
  }

  // Optional LOB filter for preview
  const lineOfBusiness = url.searchParams.get("lineOfBusiness") ?? undefined;

  // Fetch submissions from the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const whereClause: Record<string, unknown> = {
    createdAt: { gte: thirtyDaysAgo },
  };
  if (lineOfBusiness) {
    whereClause.lineOfBusiness = lineOfBusiness;
  }

  const submissions = await prisma.submission.findMany({
    where: withTenantFilter(tenantId, whereClause),
    select: {
      id: true,
      insuredName: true,
      lineOfBusiness: true,
      status: true,
      riskScore: true,
      severity: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // For each submission, fetch its non-overridden indicators to determine proposed routing
  const results: Array<{
    submissionId: string;
    insuredName: string;
    lineOfBusiness: string | null;
    riskScore: number | null;
    currentStatus: string;
    proposedStatus: string;
    changed: boolean;
  }> = [];

  // Batch-fetch indicators for all submissions
  const submissionIds = submissions.map((s) => s.id);
  const allIndicators = await prisma.fraudIndicator.findMany({
    where: {
      submissionId: { in: submissionIds },
      tenantId,
      isOverridden: false,
    },
    select: {
      submissionId: true,
      severity: true,
      category: true,
    },
  });

  // Group indicators by submission
  const indicatorsBySubmission = new Map<
    string,
    Array<{ severity: string; category: string }>
  >();
  for (const ind of allIndicators) {
    const list = indicatorsBySubmission.get(ind.submissionId) ?? [];
    list.push(ind);
    indicatorsBySubmission.set(ind.submissionId, list);
  }

  let changedCount = 0;

  for (const sub of submissions) {
    const score = sub.riskScore ?? 0;
    const indicators = indicatorsBySubmission.get(sub.id) ?? [];

    const hasCritical = indicators.some((i) => i.severity === "CRITICAL");
    const hasMediumOrAbove = indicators.some(
      (i) =>
        i.severity === "CRITICAL" ||
        i.severity === "HIGH" ||
        i.severity === "MEDIUM"
    );
    const hasForgedDocIndicator = indicators.some(
      (i) => i.category === "FORENSIC" && i.severity === "CRITICAL"
    );

    // Determine proposed routing using the same logic as routing-engine.ts
    let proposedStatus: string;

    if (proposedSiuReferral && hasForgedDocIndicator) {
      proposedStatus = "REFERRED_TO_SIU";
    } else if (score < proposedApproveBelow && !hasMediumOrAbove) {
      proposedStatus = "APPROVED";
    } else if (score > proposedEscalateAbove || hasCritical) {
      proposedStatus = "UNDER_REVIEW"; // escalated
    } else {
      proposedStatus = "UNDER_REVIEW"; // standard review
    }

    const changed = sub.status !== proposedStatus;
    if (changed) changedCount++;

    results.push({
      submissionId: sub.id,
      insuredName: sub.insuredName,
      lineOfBusiness: sub.lineOfBusiness,
      riskScore: sub.riskScore,
      currentStatus: sub.status,
      proposedStatus,
      changed,
    });
  }

  // Summary statistics
  const currentCounts = {
    APPROVED: submissions.filter((s) => s.status === "APPROVED").length,
    UNDER_REVIEW: submissions.filter((s) => s.status === "UNDER_REVIEW").length,
    DECLINED: submissions.filter((s) => s.status === "DECLINED").length,
    REFERRED_TO_SIU: submissions.filter((s) => s.status === "REFERRED_TO_SIU")
      .length,
    PROCESSING: submissions.filter((s) => s.status === "PROCESSING").length,
    INFO_NEEDED: submissions.filter((s) => s.status === "INFO_NEEDED").length,
  };

  const proposedCounts = {
    APPROVED: results.filter((r) => r.proposedStatus === "APPROVED").length,
    UNDER_REVIEW: results.filter((r) => r.proposedStatus === "UNDER_REVIEW")
      .length,
    REFERRED_TO_SIU: results.filter(
      (r) => r.proposedStatus === "REFERRED_TO_SIU"
    ).length,
  };

  return NextResponse.json({
    data: {
      proposedThresholds: {
        autoApproveBelow: proposedApproveBelow,
        autoEscalateAbove: proposedEscalateAbove,
        siuReferralOnCritical: proposedSiuReferral,
      },
      period: {
        from: thirtyDaysAgo.toISOString(),
        to: new Date().toISOString(),
      },
      totalSubmissions: submissions.length,
      changedCount,
      currentDistribution: currentCounts,
      proposedDistribution: proposedCounts,
      submissions: results,
    },
  });
});
