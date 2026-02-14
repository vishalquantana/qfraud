import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, withTenantFilter } from "@/lib/rbac";
import { getUserId } from "@/lib/api-handler";
import { uploadToS3 } from "@/lib/s3";

// ─── Constants ──────────────────────────────────────────

const MAX_FILES = 50;
const MAX_TOTAL_SIZE = 500 * 1024 * 1024; // 500MB

const ACCEPTED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/tiff",
]);

const ACCEPTED_EXTENSIONS = new Set([
  ".pdf",
  ".xlsx",
  ".docx",
  ".jpg",
  ".jpeg",
  ".png",
  ".tiff",
  ".tif",
]);

function isAcceptedFile(file: File): boolean {
  if (ACCEPTED_TYPES.has(file.type)) return true;
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? ACCEPTED_EXTENSIONS.has(ext) : false;
}

function getContentType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
  };
  return ext
    ? (map[ext] ?? "application/octet-stream")
    : "application/octet-stream";
}

// ─── POST /api/submissions ──────────────────────────────

export const POST = withTenant(async (ctx) => {
  const { req, auth, tenantId } = ctx;
  const userId = getUserId(auth);
  if (!userId) {
    return NextResponse.json(
      { error: "API key auth requires a user context for submissions" },
      { status: 400 }
    );
  }

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart form data" },
      { status: 400 }
    );
  }

  const insuredName = formData.get("insuredName");
  if (!insuredName || typeof insuredName !== "string") {
    return NextResponse.json(
      { error: "insuredName is required" },
      { status: 400 }
    );
  }

  const lineOfBusiness = formData.get("lineOfBusiness");
  const channel = formData.get("channel");

  // Collect files
  const files: File[] = [];
  for (const [, value] of formData.entries()) {
    if (value instanceof File) {
      files.push(value);
    }
  }

  if (files.length === 0) {
    return NextResponse.json(
      { error: "At least one file is required" },
      { status: 400 }
    );
  }

  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Maximum ${MAX_FILES} files per submission` },
      { status: 400 }
    );
  }

  // Validate file types and total size
  const invalidFiles: string[] = [];
  let totalSize = 0;

  for (const file of files) {
    if (!isAcceptedFile(file)) {
      invalidFiles.push(file.name);
    }
    totalSize += file.size;
  }

  if (invalidFiles.length > 0) {
    return NextResponse.json(
      {
        error: `Invalid file type(s): ${invalidFiles.join(", ")}. Accepted: PDF, XLSX, DOCX, JPG, PNG, TIFF`,
      },
      { status: 400 }
    );
  }

  if (totalSize > MAX_TOTAL_SIZE) {
    return NextResponse.json(
      { error: `Total file size exceeds 500MB limit` },
      { status: 400 }
    );
  }

  // Create submission record
  const submission = await prisma.submission.create({
    data: {
      tenantId,
      submitterId: userId,
      insuredName: insuredName.trim(),
      lineOfBusiness:
        typeof lineOfBusiness === "string" ? lineOfBusiness.trim() : null,
      channel:
        channel === "EMAIL" ? "EMAIL" : channel === "API" ? "API" : "PORTAL",
      status: "PROCESSING",
    },
  });

  // Upload files and create document records
  const documentResults: Array<{
    documentId: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    status: "uploaded" | "error";
    error?: string;
  }> = [];

  for (const file of files) {
    // Create document record first to get the ID
    const document = await prisma.document.create({
      data: {
        submissionId: submission.id,
        tenantId,
        fileName: file.name,
        fileType: getContentType(file),
        fileSize: file.size,
        s3Key: "", // Will be updated after upload
        status: "UPLOADED",
      },
    });

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const s3Key = await uploadToS3(
        tenantId,
        submission.id,
        document.id,
        file.name,
        buffer,
        getContentType(file)
      );

      // Update document with S3 key
      await prisma.document.update({
        where: { id: document.id },
        data: { s3Key },
      });

      documentResults.push({
        documentId: document.id,
        fileName: file.name,
        fileSize: file.size,
        fileType: getContentType(file),
        status: "uploaded",
      });
    } catch (err) {
      // Mark document as error if upload fails
      await prisma.document.update({
        where: { id: document.id },
        data: { status: "ERROR" },
      });

      documentResults.push({
        documentId: document.id,
        fileName: file.name,
        fileSize: file.size,
        fileType: getContentType(file),
        status: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  return NextResponse.json(
    {
      submissionId: submission.id,
      status: submission.status,
      documents: documentResults,
    },
    { status: 201 }
  );
});

// ─── GET /api/submissions ───────────────────────────────

export const GET = withTenant(async (ctx) => {
  const { req, auth, tenantId } = ctx;
  const url = new URL(req.url);

  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10))
  );
  const skip = (page - 1) * limit;

  // Build filter
  const where: Record<string, unknown> = {};
  const status = url.searchParams.get("status");
  if (status) where.status = status;
  const severity = url.searchParams.get("severity");
  if (severity) where.severity = severity;

  // Date range filter
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) createdAt.gte = new Date(dateFrom);
    if (dateTo) createdAt.lte = new Date(dateTo);
    where.createdAt = createdAt;
  }

  // Broker filter (by submitter email or name)
  const broker = url.searchParams.get("broker");
  if (broker) {
    where.submitter = {
      OR: [
        { name: { contains: broker, mode: "insensitive" } },
        { email: { contains: broker, mode: "insensitive" } },
      ],
    };
  }

  // Brokers can only see their own submissions
  const userId = getUserId(auth);
  if (auth.type === "user" && auth.user.role === "BROKER" && userId) {
    where.submitterId = userId;
  }

  const [submissions, total] = await Promise.all([
    prisma.submission.findMany({
      where: withTenantFilter(tenantId, where),
      include: {
        documents: { select: { id: true, fileName: true, status: true } },
        submitter: { select: { id: true, name: true, email: true } },
        assignedUnderwriter: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.submission.count({
      where: withTenantFilter(tenantId, where),
    }),
  ]);

  return NextResponse.json({
    data: submissions,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});
