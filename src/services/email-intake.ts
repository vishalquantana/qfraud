import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { uploadToS3 } from "@/lib/s3";
import { sendNotification } from "@/services/notification";
import { logAudit } from "@/services/audit-log";
import JSZip from "jszip";

const log = createLogger("email-intake");

// ─── Types ──────────────────────────────────────────────────

export interface InboundEmailPayload {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments: InboundAttachment[];
}

export interface InboundAttachment {
  filename: string;
  content: string; // base64 encoded
  contentType: string;
  size: number;
}

interface ProcessedFile {
  filename: string;
  buffer: Buffer;
  contentType: string;
  size: number;
}

// ─── Constants ──────────────────────────────────────────────

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

const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/tiff",
]);

const EXTENSION_TO_MIME: Record<string, string> = {
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

const MAX_FILES = 50;
const MAX_TOTAL_SIZE = 500 * 1024 * 1024; // 500MB

// ─── Helpers ────────────────────────────────────────────────

function getExtension(filename: string): string {
  return (filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "");
}

function isAcceptedFile(filename: string, contentType: string): boolean {
  if (ACCEPTED_MIME_TYPES.has(contentType)) return true;
  return ACCEPTED_EXTENSIONS.has(getExtension(filename));
}

function resolveContentType(filename: string, contentType: string): string {
  if (contentType && contentType !== "application/octet-stream") {
    return contentType;
  }
  return EXTENSION_TO_MIME[getExtension(filename)] ?? "application/octet-stream";
}

function isZipFile(filename: string, contentType: string): boolean {
  const ext = getExtension(filename);
  return (
    ext === ".zip" ||
    contentType === "application/zip" ||
    contentType === "application/x-zip-compressed"
  );
}

/**
 * Extract the tenant slug from the recipient email address.
 * Expected format: submissions@{tenant-slug}.quantanashield.com
 */
function extractTenantSlug(toEmail: string): string | null {
  const match = toEmail
    .toLowerCase()
    .match(/^submissions@([^.]+)\.quantanashield\.com$/);
  return match ? match[1] : null;
}

/**
 * Extract sender email address, handling formats like:
 * - "user@example.com"
 * - "John Smith <user@example.com>"
 */
function parseSenderEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

/**
 * Extract files from a zip attachment.
 */
async function extractZipContents(
  zipBuffer: Buffer,
): Promise<ProcessedFile[]> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const files: ProcessedFile[] = [];

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    const filename = relativePath.split("/").pop() ?? relativePath;
    // Skip hidden/system files
    if (filename.startsWith(".") || filename.startsWith("__MACOSX")) continue;

    const ext = getExtension(filename);
    if (!ACCEPTED_EXTENSIONS.has(ext)) continue;

    const buffer = Buffer.from(await zipEntry.async("uint8array"));
    const contentType = EXTENSION_TO_MIME[ext] ?? "application/octet-stream";

    files.push({
      filename,
      buffer,
      contentType,
      size: buffer.length,
    });
  }

  return files;
}

// ─── Main Intake Function ───────────────────────────────────

export interface EmailIntakeResult {
  success: boolean;
  submissionId?: string;
  documentCount?: number;
  error?: string;
}

export async function processInboundEmail(
  payload: InboundEmailPayload,
): Promise<EmailIntakeResult> {
  const senderEmail = parseSenderEmail(payload.from);

  // 1. Resolve tenant from recipient email
  const tenantSlug = extractTenantSlug(payload.to);
  if (!tenantSlug) {
    return {
      success: false,
      error: `Invalid recipient address: ${payload.to}. Expected submissions@{tenant-slug}.quantanashield.com`,
    };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
  });

  if (!tenant) {
    return {
      success: false,
      error: `Tenant not found for slug: ${tenantSlug}`,
    };
  }

  // 2. Look up sender as a user (broker) in the tenant
  const senderUser = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: senderEmail } },
  });

  if (!senderUser) {
    return {
      success: false,
      error: `Sender ${senderEmail} is not a registered user for tenant ${tenant.name}`,
    };
  }

  // 3. Collect and validate attachments (including zip extraction)
  const processedFiles: ProcessedFile[] = [];

  for (const attachment of payload.attachments) {
    const buffer = Buffer.from(attachment.content, "base64");

    if (isZipFile(attachment.filename, attachment.contentType)) {
      try {
        const extracted = await extractZipContents(buffer);
        processedFiles.push(...extracted);
      } catch (err) {
        log.error(
          { err, filename: attachment.filename },
          "failed to extract zip"
        );
        // Skip bad zips, continue processing other attachments
      }
    } else if (isAcceptedFile(attachment.filename, attachment.contentType)) {
      processedFiles.push({
        filename: attachment.filename,
        buffer,
        contentType: resolveContentType(
          attachment.filename,
          attachment.contentType,
        ),
        size: buffer.length,
      });
    }
    // Non-accepted file types are silently skipped
  }

  // 4. Validate we have files to process
  if (processedFiles.length === 0) {
    // Send error notification to sender
    await sendNotification(
      "SUBMISSION_RECEIVED",
      senderEmail,
      tenant.id,
      {
        insuredName: payload.subject || "Email Submission",
      },
    );

    return {
      success: false,
      error:
        "No valid attachments found. Accepted formats: PDF, XLSX, DOCX, JPG, PNG, TIFF",
    };
  }

  // Enforce limits
  if (processedFiles.length > MAX_FILES) {
    return {
      success: false,
      error: `Too many files: ${processedFiles.length}. Maximum ${MAX_FILES} per submission.`,
    };
  }

  const totalSize = processedFiles.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    return {
      success: false,
      error: `Total file size exceeds 500MB limit.`,
    };
  }

  // 5. Create submission record
  const insuredName =
    payload.subject?.replace(/^(fwd?:|re:)\s*/gi, "").trim() ||
    "Email Submission";

  const submission = await prisma.submission.create({
    data: {
      tenantId: tenant.id,
      submitterId: senderUser.id,
      insuredName,
      channel: "EMAIL",
      status: "PROCESSING",
    },
  });

  // 6. Upload files to S3 and create document records
  let uploadedCount = 0;

  for (const file of processedFiles) {
    const document = await prisma.document.create({
      data: {
        submissionId: submission.id,
        tenantId: tenant.id,
        fileName: file.filename,
        fileType: file.contentType,
        fileSize: file.size,
        s3Key: "",
        status: "UPLOADED",
      },
    });

    try {
      const s3Key = await uploadToS3(
        tenant.id,
        submission.id,
        document.id,
        file.filename,
        file.buffer,
        file.contentType,
      );

      await prisma.document.update({
        where: { id: document.id },
        data: { s3Key },
      });

      uploadedCount++;
    } catch (err) {
      log.error(
        { err, filename: file.filename },
        "failed to upload to S3"
      );
      await prisma.document.update({
        where: { id: document.id },
        data: { status: "ERROR" },
      });
    }
  }

  // 7. Log the submission creation
  await logAudit({
    tenantId: tenant.id,
    action: "SUBMISSION_CREATED",
    details: {
      channel: "EMAIL",
      senderEmail,
      subject: payload.subject,
      attachmentCount: payload.attachments.length,
      processedFileCount: processedFiles.length,
      uploadedCount,
    },
    userId: senderUser.id,
    submissionId: submission.id,
  });

  // 8. Send auto-acknowledgment email to sender
  const trackingUrl = `${process.env.NEXTAUTH_URL || "https://app.quantanashield.com"}/portal/submissions/${submission.id}`;

  await sendNotification(
    "SUBMISSION_RECEIVED",
    senderEmail,
    tenant.id,
    {
      submissionId: submission.id,
      insuredName,
      trackingUrl,
    },
  );

  return {
    success: true,
    submissionId: submission.id,
    documentCount: uploadedCount,
  };
}
