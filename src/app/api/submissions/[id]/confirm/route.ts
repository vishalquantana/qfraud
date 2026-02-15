import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, withTenantFilter } from "@/lib/rbac";
import { getUserId } from "@/lib/api-handler";
import { enqueueSubmission } from "@/lib/queue";

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

  // Enqueue for async processing via BullMQ
  const job = await enqueueSubmission(submissionId, tenantId);

  return NextResponse.json(
    {
      data: {
        id: submissionId,
        status: "PROCESSING",
        jobId: job.id,
        message: "Submission confirmed and queued for processing.",
      },
    },
    { status: 202 }
  );
});
