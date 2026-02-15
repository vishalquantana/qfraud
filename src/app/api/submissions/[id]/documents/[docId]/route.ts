import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, withTenantFilter } from "@/lib/rbac";
import { getUserId } from "@/lib/api-handler";
import { uploadToS3 } from "@/lib/s3";
import type { DocumentType } from "@/generated/prisma/client";

const VALID_DOC_TYPES: DocumentType[] = [
  "ACORD_125",
  "ACORD_130",
  "ACORD_140",
  "LOSS_RUN",
  "FINANCIAL_STATEMENT",
  "COI",
  "ENTITY_DOC",
  "INSPECTION_PHOTO",
  "MVR",
  "SOV",
  "SURPLUS_LINES",
  "PROFESSIONAL_LICENSE",
  "ENVIRONMENTAL_REPORT",
  "PAYROLL_TAX",
  "BROKER_SUBMISSION",
  "FLEET_SCHEDULE",
  "UNKNOWN",
];

// ─── PATCH /api/submissions/:id/documents/:docId ────────
// Update document type (classification correction)

export const PATCH = withTenant(async (ctx, params) => {
  const { auth, tenantId } = ctx;
  const submissionId = params?.id;
  const docId = params?.docId;

  if (!submissionId || !docId) {
    return NextResponse.json(
      { error: "Submission ID and Document ID required" },
      { status: 400 }
    );
  }

  let body: { documentType?: string };
  try {
    body = await ctx.req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { documentType } = body;
  if (!documentType || !VALID_DOC_TYPES.includes(documentType as DocumentType)) {
    return NextResponse.json(
      { error: `Invalid document type. Must be one of: ${VALID_DOC_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  // Verify submission belongs to tenant
  const submission = await prisma.submission.findFirst({
    where: withTenantFilter(tenantId, { id: submissionId }),
  });

  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  // Brokers can only update their own submissions
  const userId = getUserId(auth);
  if (auth.type === "user" && auth.user.role === "BROKER") {
    if (submission.submitterId !== userId) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }
  }

  // Update the document type
  const document = await prisma.document.findFirst({
    where: { id: docId, submissionId, tenantId },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const updated = await prisma.document.update({
    where: { id: docId },
    data: {
      documentType: documentType as DocumentType,
      classificationConfidence: 1.0,
    },
    select: {
      id: true,
      fileName: true,
      documentType: true,
      classificationConfidence: true,
      status: true,
    },
  });

  return NextResponse.json({ data: updated });
});

// ─── PUT /api/submissions/:id/documents/:docId ──────────
// Re-upload (replace) a document file

const ACCEPTED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/tiff",
]);

export const PUT = withTenant(async (ctx, params) => {
  const { auth, tenantId } = ctx;
  const submissionId = params?.id;
  const docId = params?.docId;

  if (!submissionId || !docId) {
    return NextResponse.json(
      { error: "Submission ID and Document ID required" },
      { status: 400 }
    );
  }

  // Verify submission belongs to tenant and broker owns it
  const submission = await prisma.submission.findFirst({
    where: withTenantFilter(tenantId, { id: submissionId }),
  });

  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  const userId = getUserId(auth);
  if (auth.type === "user" && auth.user.role === "BROKER") {
    if (submission.submitterId !== userId) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }
  }

  // Find the existing document
  const document = await prisma.document.findFirst({
    where: { id: docId, submissionId, tenantId },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // Parse the uploaded file
  const formData = await ctx.req.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Validate file type
  const fileType = file.type || "application/octet-stream";
  if (!ACCEPTED_TYPES.has(fileType)) {
    return NextResponse.json(
      { error: "Invalid file type. Accepted: PDF, XLSX, DOCX, JPG, PNG, TIFF." },
      { status: 400 }
    );
  }

  // Upload to S3
  const buffer = Buffer.from(await file.arrayBuffer());
  const s3Key = await uploadToS3(
    tenantId,
    submissionId,
    docId,
    file.name,
    buffer,
    fileType
  );

  // Update the document record
  const updated = await prisma.document.update({
    where: { id: docId },
    data: {
      fileName: file.name,
      fileType,
      fileSize: file.size,
      s3Key,
      status: "UPLOADED",
      documentType: "UNKNOWN",
      classificationConfidence: null,
      extractedData: undefined,
    },
    select: {
      id: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      documentType: true,
      classificationConfidence: true,
      status: true,
    },
  });

  return NextResponse.json({ data: updated });
});
