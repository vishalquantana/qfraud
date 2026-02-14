import { prisma } from "@/lib/prisma";
import type { Acord125ExtractedData } from "@/services/extraction-acord125";
import type { COIExtractedData } from "@/services/extraction-coi";
import type { LossRunExtractedData } from "@/services/extraction-loss-run";

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
 * Parse a date string in common formats (MM/DD/YYYY, YYYY-MM-DD, MM-DD-YYYY, etc.).
 * Returns null if parsing fails.
 */
function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;

  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // Try ISO format (YYYY-MM-DD)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const d = new Date(
      parseInt(isoMatch[1]),
      parseInt(isoMatch[2]) - 1,
      parseInt(isoMatch[3]),
    );
    if (!isNaN(d.getTime())) return d;
  }

  // Try MM/DD/YYYY or MM-DD-YYYY
  const usMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (usMatch) {
    const d = new Date(
      parseInt(usMatch[3]),
      parseInt(usMatch[1]) - 1,
      parseInt(usMatch[2]),
    );
    if (!isNaN(d.getTime())) return d;
  }

  // Try MM/DD/YY or MM-DD-YY
  const usShortMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (usShortMatch) {
    let year = parseInt(usShortMatch[3]);
    year += year < 50 ? 2000 : 1900;
    const d = new Date(year, parseInt(usShortMatch[1]) - 1, parseInt(usShortMatch[2]));
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback to native Date parsing
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  return null;
}

/**
 * Calculate the number of days between two dates.
 */
function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(b.getTime() - a.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Calculate the number of months between two dates.
 */
function monthsBetween(a: Date, b: Date): number {
  const early = a < b ? a : b;
  const late = a < b ? b : a;
  return (
    (late.getFullYear() - early.getFullYear()) * 12 +
    (late.getMonth() - early.getMonth())
  );
}

// ─── Coverage gap detection ─────────────────────────────

/**
 * Flag gaps >30 days in prior coverage from COI/loss run dates.
 *
 * Compares the COI or loss run effective dates against the ACORD 125
 * requested effective date to find coverage gaps.
 */
async function detectCoverageGaps(
  submissionId: string,
  tenantId: string,
): Promise<void> {
  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );
  if (!acord125) return;

  const requestedEffective = parseDate(acord125.data.effectiveDate);
  if (!requestedEffective) return;

  // Collect prior coverage end dates from COIs
  const coiDocs = await prisma.document.findMany({
    where: {
      submissionId,
      documentType: "COI",
      status: "ANALYZED",
    },
    orderBy: { createdAt: "desc" },
  });

  const coveragePeriods: Array<{
    source: string;
    documentId: string;
    startDate: Date;
    endDate: Date;
  }> = [];

  for (const doc of coiDocs) {
    if (!doc.extractedData) continue;
    const data = doc.extractedData as unknown as COIExtractedData;
    const start = parseDate(data.effectiveDate);
    const end = parseDate(data.expirationDate);
    if (start && end) {
      coveragePeriods.push({
        source: "COI",
        documentId: doc.id,
        startDate: start,
        endDate: end,
      });
    }
  }

  // Collect policy periods from loss runs
  const lossRunDocs = await prisma.document.findMany({
    where: {
      submissionId,
      documentType: "LOSS_RUN",
      status: "ANALYZED",
    },
    orderBy: { createdAt: "desc" },
  });

  for (const doc of lossRunDocs) {
    if (!doc.extractedData) continue;
    const data = doc.extractedData as unknown as LossRunExtractedData;
    if (data.policyPeriod) {
      // Parse policy period format: "MM/DD/YYYY - MM/DD/YYYY" or "MM/DD/YYYY to MM/DD/YYYY"
      const parts = data.policyPeriod.split(/\s*[-–—to]+\s*/i);
      if (parts.length >= 2) {
        const start = parseDate(parts[0]);
        const end = parseDate(parts[1]);
        if (start && end) {
          coveragePeriods.push({
            source: "Loss Run",
            documentId: doc.id,
            startDate: start,
            endDate: end,
          });
        }
      }
    }
  }

  if (coveragePeriods.length === 0) return;

  // Sort periods by end date descending to find the most recent prior coverage
  coveragePeriods.sort((a, b) => b.endDate.getTime() - a.endDate.getTime());

  // Check gap between most recent prior coverage end and requested effective date
  const mostRecent = coveragePeriods[0];
  const gapDays = daysBetween(mostRecent.endDate, requestedEffective);

  // Only flag if the requested date is after the prior coverage ended (actual gap)
  if (requestedEffective <= mostRecent.endDate) return;
  if (gapDays <= 30) return;

  const evidence = {
    priorCoverageEndDate: mostRecent.endDate.toISOString().split("T")[0],
    requestedEffectiveDate: requestedEffective.toISOString().split("T")[0],
    gapDays,
    priorCoverageSource: mostRecent.source,
    priorCoverageDocumentId: mostRecent.documentId,
    acordDocumentId: acord125.documentId,
  };

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      category: "TEMPORAL",
      indicatorName: "COVERAGE_GAP",
      description: `${gapDays}-day gap in coverage detected between prior coverage ending ${evidence.priorCoverageEndDate} and requested effective date ${evidence.requestedEffectiveDate}. Coverage gaps may indicate prior cancellation or non-renewal.`,
      severity: "HIGH",
      evidence: JSON.parse(JSON.stringify(evidence)),
      confidence: 0.75,
      recommendedAction:
        "Request explanation for the coverage gap. Verify if prior coverage was cancelled, non-renewed, or if the applicant was uninsured.",
    },
  });
}

// ─── Claim timing clusters ──────────────────────────────

/**
 * Flag if >50% of claims occurred within 60 days of policy inception/expiration.
 *
 * Claims clustered near policy boundaries may indicate opportunistic filing.
 */
async function detectClaimTimingClusters(
  submissionId: string,
  tenantId: string,
): Promise<void> {
  // Find all loss run documents
  const lossRunDocs = await prisma.document.findMany({
    where: {
      submissionId,
      documentType: "LOSS_RUN",
      status: "ANALYZED",
    },
    orderBy: { createdAt: "desc" },
  });

  if (lossRunDocs.length === 0) return;

  // Collect all claims with dates and corresponding policy periods
  const claimsWithContext: Array<{
    dateOfLoss: Date;
    policyStart: Date | null;
    policyEnd: Date | null;
    documentId: string;
    claimNumber: string | null;
  }> = [];

  for (const doc of lossRunDocs) {
    if (!doc.extractedData) continue;
    const data = doc.extractedData as unknown as LossRunExtractedData;

    let policyStart: Date | null = null;
    let policyEnd: Date | null = null;
    if (data.policyPeriod) {
      const parts = data.policyPeriod.split(/\s*[-–—to]+\s*/i);
      if (parts.length >= 2) {
        policyStart = parseDate(parts[0]);
        policyEnd = parseDate(parts[1]);
      }
    }

    for (const claim of data.claims ?? []) {
      const lossDate = parseDate(claim.dateOfLoss);
      if (lossDate) {
        claimsWithContext.push({
          dateOfLoss: lossDate,
          policyStart,
          policyEnd,
          documentId: doc.id,
          claimNumber: claim.claimNumber,
        });
      }
    }
  }

  if (claimsWithContext.length < 3) return; // Need at least 3 claims to detect clusters

  // Count claims within 60 days of policy inception or expiration
  let boundaryClaimCount = 0;
  const boundaryClaimDetails: Array<{
    claimNumber: string | null;
    dateOfLoss: string;
    boundary: string;
    daysFromBoundary: number;
  }> = [];

  for (const claim of claimsWithContext) {
    if (claim.policyStart) {
      const daysFromStart = daysBetween(claim.dateOfLoss, claim.policyStart);
      if (claim.dateOfLoss >= claim.policyStart && daysFromStart <= 60) {
        boundaryClaimCount++;
        boundaryClaimDetails.push({
          claimNumber: claim.claimNumber,
          dateOfLoss: claim.dateOfLoss.toISOString().split("T")[0],
          boundary: "inception",
          daysFromBoundary: daysFromStart,
        });
        continue;
      }
    }
    if (claim.policyEnd) {
      const daysFromEnd = daysBetween(claim.dateOfLoss, claim.policyEnd);
      if (claim.dateOfLoss <= claim.policyEnd && daysFromEnd <= 60) {
        boundaryClaimCount++;
        boundaryClaimDetails.push({
          claimNumber: claim.claimNumber,
          dateOfLoss: claim.dateOfLoss.toISOString().split("T")[0],
          boundary: "expiration",
          daysFromBoundary: daysFromEnd,
        });
      }
    }
  }

  const totalClaims = claimsWithContext.length;
  const boundaryPercent = (boundaryClaimCount / totalClaims) * 100;

  if (boundaryPercent <= 50) return;

  const evidence = {
    totalClaims,
    boundaryClaimCount,
    boundaryPercent: Math.round(boundaryPercent * 100) / 100,
    boundaryClaimDetails,
    lossRunDocumentIds: lossRunDocs.map((d) => d.id),
  };

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      category: "TEMPORAL",
      indicatorName: "CLAIM_TIMING_CLUSTER",
      description: `${boundaryClaimCount} of ${totalClaims} claims (${evidence.boundaryPercent}%) occurred within 60 days of policy inception or expiration. Clustered claim timing may indicate opportunistic filing.`,
      severity: "HIGH",
      evidence: JSON.parse(JSON.stringify(evidence)),
      confidence: 0.7,
      recommendedAction:
        "Review claim circumstances and verify that loss dates align with documented incidents. Clustered claims near policy boundaries warrant closer examination.",
    },
  });
}

// ─── Document staleness ─────────────────────────────────

/**
 * Flag stale documents based on document type and the submission date:
 * - Inspection reports >6 months old (MEDIUM)
 * - MVRs >30 days old (MEDIUM)
 * - Environmental reports (ESA) >12 months old (MEDIUM)
 */
async function detectDocumentStaleness(
  submissionId: string,
  tenantId: string,
): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
  });

  const submissionDate = submission.createdAt;

  // Staleness rules: documentType → max age in months
  const stalenessRules: Array<{
    documentType: string;
    maxAgeMonths: number;
    label: string;
  }> = [
    {
      documentType: "INSPECTION_PHOTO",
      maxAgeMonths: 6,
      label: "Inspection report",
    },
    { documentType: "MVR", maxAgeMonths: 1, label: "Motor vehicle report" },
    {
      documentType: "ENVIRONMENTAL_REPORT",
      maxAgeMonths: 12,
      label: "Environmental site assessment",
    },
  ];

  for (const rule of stalenessRules) {
    const docs = await prisma.document.findMany({
      where: {
        submissionId,
        documentType: rule.documentType as never,
        status: "ANALYZED",
      },
    });

    for (const doc of docs) {
      // Check document creation date (when the actual document was created/dated)
      // Use the file's creation timestamp as a proxy — real implementation would
      // use the date extracted from the document content
      const docDate = doc.createdAt;
      const ageMonths = monthsBetween(docDate, submissionDate);

      if (ageMonths <= rule.maxAgeMonths) continue;

      const evidence = {
        documentId: doc.id,
        documentType: rule.documentType,
        documentFileName: doc.fileName,
        documentDate: docDate.toISOString().split("T")[0],
        submissionDate: submissionDate.toISOString().split("T")[0],
        ageMonths,
        maxAgeMonths: rule.maxAgeMonths,
      };

      await prisma.fraudIndicator.create({
        data: {
          submissionId,
          tenantId,
          documentId: doc.id,
          category: "TEMPORAL",
          indicatorName: "DOCUMENT_STALENESS",
          description: `${rule.label} "${doc.fileName}" is ${ageMonths} months old (max allowed: ${rule.maxAgeMonths} months). Stale documents may not reflect current conditions.`,
          severity: "MEDIUM",
          evidence: JSON.parse(JSON.stringify(evidence)),
          confidence: 0.6,
          recommendedAction: `Request an updated ${rule.label.toLowerCase()}. Documents older than ${rule.maxAgeMonths} months may not accurately represent current conditions.`,
        },
      });
    }
  }
}

// ─── Impossible dates ───────────────────────────────────

/**
 * Flag impossible date relationships:
 * - Loss run effective date before policy effective date (CRITICAL)
 * - COI expiration before COI effective date (CRITICAL)
 * - Document dates in the future relative to submission (CRITICAL)
 */
async function detectImpossibleDates(
  submissionId: string,
  tenantId: string,
): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
  });

  const submissionDate = submission.createdAt;

  // Get ACORD 125 effective date as the policy effective date
  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );
  const policyEffective = parseDate(acord125?.data.effectiveDate);

  // Check 1: Loss run effective date before policy effective date
  if (policyEffective) {
    const lossRunDocs = await prisma.document.findMany({
      where: {
        submissionId,
        documentType: "LOSS_RUN",
        status: "ANALYZED",
      },
    });

    for (const doc of lossRunDocs) {
      if (!doc.extractedData) continue;
      const data = doc.extractedData as unknown as LossRunExtractedData;
      if (!data.policyPeriod) continue;

      const parts = data.policyPeriod.split(/\s*[-–—to]+\s*/i);
      if (parts.length < 2) continue;

      const lossRunEffective = parseDate(parts[0]);
      const lossRunExpiration = parseDate(parts[1]);

      // Flag if loss run effective is AFTER policy effective (impossible — loss run
      // should cover prior periods)
      if (
        lossRunExpiration &&
        policyEffective &&
        lossRunEffective &&
        lossRunEffective > policyEffective
      ) {
        const evidence = {
          lossRunEffectiveDate: lossRunEffective.toISOString().split("T")[0],
          lossRunExpirationDate: lossRunExpiration.toISOString().split("T")[0],
          policyEffectiveDate: policyEffective.toISOString().split("T")[0],
          lossRunDocumentId: doc.id,
          acordDocumentId: acord125?.documentId,
        };

        await prisma.fraudIndicator.create({
          data: {
            submissionId,
            tenantId,
            documentId: doc.id,
            category: "TEMPORAL",
            indicatorName: "IMPOSSIBLE_DATE_LOSS_RUN",
            description: `Loss run effective date (${evidence.lossRunEffectiveDate}) is after the policy effective date (${evidence.policyEffectiveDate}). Loss runs should cover prior periods.`,
            severity: "CRITICAL",
            evidence: JSON.parse(JSON.stringify(evidence)),
            confidence: 0.9,
            recommendedAction:
              "Verify loss run dates — the loss run period should cover time before the requested policy effective date. Request corrected loss runs.",
          },
        });
      }
    }
  }

  // Check 2: COI expiration before effective date (impossible)
  const coiDocs = await prisma.document.findMany({
    where: {
      submissionId,
      documentType: "COI",
      status: "ANALYZED",
    },
  });

  for (const doc of coiDocs) {
    if (!doc.extractedData) continue;
    const data = doc.extractedData as unknown as COIExtractedData;
    const effective = parseDate(data.effectiveDate);
    const expiration = parseDate(data.expirationDate);

    if (effective && expiration && expiration < effective) {
      const evidence = {
        coiEffectiveDate: effective.toISOString().split("T")[0],
        coiExpirationDate: expiration.toISOString().split("T")[0],
        coiDocumentId: doc.id,
      };

      await prisma.fraudIndicator.create({
        data: {
          submissionId,
          tenantId,
          documentId: doc.id,
          category: "TEMPORAL",
          indicatorName: "IMPOSSIBLE_DATE_COI",
          description: `COI expiration date (${evidence.coiExpirationDate}) is before effective date (${evidence.coiEffectiveDate}). This is logically impossible and may indicate a forged certificate.`,
          severity: "CRITICAL",
          evidence: JSON.parse(JSON.stringify(evidence)),
          confidence: 0.95,
          recommendedAction:
            "Request a corrected COI — the expiration date precedes the effective date, which is impossible for a valid certificate.",
        },
      });
    }

    // Check 3: COI effective date in the far future relative to submission
    if (effective && effective.getTime() > submissionDate.getTime() + 365 * 24 * 60 * 60 * 1000) {
      const evidence = {
        coiEffectiveDate: effective.toISOString().split("T")[0],
        submissionDate: submissionDate.toISOString().split("T")[0],
        daysInFuture: daysBetween(submissionDate, effective),
        coiDocumentId: doc.id,
      };

      await prisma.fraudIndicator.create({
        data: {
          submissionId,
          tenantId,
          documentId: doc.id,
          category: "TEMPORAL",
          indicatorName: "IMPOSSIBLE_DATE_FUTURE",
          description: `COI effective date (${evidence.coiEffectiveDate}) is ${evidence.daysInFuture} days in the future relative to the submission date. Documents with dates far in the future may be fabricated.`,
          severity: "CRITICAL",
          evidence: JSON.parse(JSON.stringify(evidence)),
          confidence: 0.85,
          recommendedAction:
            "Verify the COI dates — an effective date more than a year in the future is highly unusual and may indicate document fabrication.",
        },
      });
    }
  }
}

// ─── Main service ──────────────────────────────────────

/**
 * Run all temporal anomaly checks for a submission.
 *
 * Checks:
 * 1. Coverage gap detection: flag gaps >30 days in prior coverage (HIGH)
 * 2. Claim timing clusters: flag if >50% of claims near policy boundaries (HIGH)
 * 3. Document staleness: flag inspection reports >6 months, MVRs >30 days, ESAs >12 months (MEDIUM)
 * 4. Impossible dates: flag logically impossible date relationships (CRITICAL)
 *
 * Creates FraudIndicator records with category TEMPORAL.
 * Skips gracefully if required documents are missing.
 */
export async function detectTemporalAnomalies(
  submissionId: string,
): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
  });

  const tenantId = submission.tenantId;

  await Promise.all([
    detectCoverageGaps(submissionId, tenantId),
    detectClaimTimingClusters(submissionId, tenantId),
    detectDocumentStaleness(submissionId, tenantId),
    detectImpossibleDates(submissionId, tenantId),
  ]);
}
