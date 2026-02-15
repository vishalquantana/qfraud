import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, withTenantFilter } from "@/lib/rbac";
import { getUserId } from "@/lib/api-handler";
import { processSubmission } from "@/services/pipeline";

// ─── POST /api/submissions/:id/confirm ──────────────────
// Confirms a submission and triggers the processing pipeline

export const POST = withTenant(async (ctx, params) => {
  const { auth, tenantId } = ctx;
  const submissionId = params?.id;

  if (!submissionId) {
    return NextResponse.json(
      { error: "Submission ID required" },
      { status: 400 }
    );
  }

  const submission = await prisma.submission.findFirst({
    where: withTenantFilter(tenantId, { id: submissionId }),
  });

  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  // Brokers can only confirm their own submissions
  const userId = getUserId(auth);
  if (auth.type === "user" && auth.user.role === "BROKER") {
    if (submission.submitterId !== userId) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }
  }

  // Check for unclassified documents
  const unknownDocs = await prisma.document.count({
    where: { submissionId, tenantId, documentType: "UNKNOWN" },
  });

  if (unknownDocs > 0) {
    return NextResponse.json(
      { error: "All documents must be classified before confirming. Please review document types." },
      { status: 400 }
    );
  }

  // Update status to PROCESSING
  await prisma.submission.update({
    where: { id: submissionId },
    data: { status: "PROCESSING" },
  });

  // Trigger the processing pipeline (fire and forget — don't block the response)
  processSubmission(submissionId).catch(() => {
    // Pipeline errors are logged internally
  });

  return NextResponse.json({
    data: {
      id: submissionId,
      status: "PROCESSING",
      message: "Submission confirmed and processing started.",
    },
  });
});
