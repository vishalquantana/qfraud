import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, withTenantFilter } from "@/lib/rbac";
import {
  getStateFraudWarning,
  extractStateFromAddress,
} from "@/services/state-fraud-warnings";

// ─── GET /api/submissions/:id/fraud-warning ──────────────
// Returns the state-mandated fraud warning text for a submission
// based on the insured's state from extracted document data.

export const GET = withTenant(async (ctx, params) => {
  const { tenantId } = ctx;
  const submissionId = params?.id;

  if (!submissionId) {
    return NextResponse.json(
      { error: "Submission ID required" },
      { status: 400 }
    );
  }

  const submission = await prisma.submission.findFirst({
    where: withTenantFilter(tenantId, { id: submissionId }),
    include: {
      documents: {
        select: { extractedData: true, documentType: true },
      },
    },
  });

  if (!submission) {
    return NextResponse.json(
      { error: "Submission not found" },
      { status: 404 }
    );
  }

  // Try to extract state code from document data
  let stateCode: string | null = null;

  for (const doc of submission.documents) {
    if (!doc.extractedData) continue;
    const data = doc.extractedData as Record<string, unknown>;

    // Check ACORD 125 and entity documents for address fields
    if (
      doc.documentType === "ACORD_125" ||
      doc.documentType === "ENTITY_DOC"
    ) {
      const address =
        (data.mailingAddress as string) ??
        (data.physicalAddress as string) ??
        (data.registeredAgentAddress as string) ??
        (data.stateOfIncorporation as string) ??
        null;
      if (address) {
        stateCode = extractStateFromAddress(address);
        if (stateCode) break;
      }

      // Check stateOfIncorporation directly (2-letter code)
      const soi = data.stateOfIncorporation as string | undefined;
      if (soi && /^[A-Z]{2}$/.test(soi.trim().toUpperCase())) {
        stateCode = soi.trim().toUpperCase();
        break;
      }
    }
  }

  const warningText = getStateFraudWarning(stateCode);

  return NextResponse.json({
    data: {
      stateCode,
      warningText,
    },
  });
});
