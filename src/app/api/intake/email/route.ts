import { NextResponse, type NextRequest } from "next/server";
import {
  processInboundEmail,
  type InboundEmailPayload,
  type InboundAttachment,
} from "@/services/email-intake";

/**
 * POST /api/intake/email
 *
 * Webhook endpoint for inbound email parsing services (e.g., SendGrid Inbound Parse).
 * Receives parsed email data and creates a submission from the attachments.
 *
 * This endpoint is unauthenticated — it's called by the email provider's webhook.
 * Security is provided by validating the recipient email format and tenant lookup.
 */
export async function POST(req: NextRequest) {
  let payload: InboundEmailPayload;

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    // SendGrid Inbound Parse sends multipart form data
    const formData = await req.formData();

    const from = (formData.get("from") as string) ?? "";
    const to = (formData.get("to") as string) ?? "";
    const subject = (formData.get("subject") as string) ?? "";
    const text = (formData.get("text") as string) ?? "";
    const html = (formData.get("html") as string) ?? "";

    // Collect file attachments from form data
    const attachments: InboundAttachment[] = [];
    for (const [key, value] of formData.entries()) {
      if (value instanceof File && key !== "from" && key !== "to") {
        const buffer = Buffer.from(await value.arrayBuffer());
        attachments.push({
          filename: value.name || key,
          content: buffer.toString("base64"),
          contentType: value.type || "application/octet-stream",
          size: value.size,
        });
      }
    }

    // Also check for SendGrid's attachment-info and attachment fields
    const attachmentInfoRaw = formData.get("attachment-info");
    if (attachmentInfoRaw && typeof attachmentInfoRaw === "string") {
      try {
        const attachmentInfo = JSON.parse(attachmentInfoRaw) as Record<
          string,
          { filename: string; type: string }
        >;
        for (const [key, info] of Object.entries(attachmentInfo)) {
          const file = formData.get(key);
          if (file instanceof File) {
            // Skip if already processed above
            const alreadyAdded = attachments.some(
              (a) => a.filename === (info.filename || file.name),
            );
            if (!alreadyAdded) {
              const buffer = Buffer.from(await file.arrayBuffer());
              attachments.push({
                filename: info.filename || file.name || key,
                content: buffer.toString("base64"),
                contentType: info.type || file.type || "application/octet-stream",
                size: file.size,
              });
            }
          }
        }
      } catch {
        // Ignore malformed attachment-info
      }
    }

    payload = { from, to, subject, text, html, attachments };
  } else {
    // JSON payload (from other webhook providers or direct API calls)
    try {
      payload = (await req.json()) as InboundEmailPayload;
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }
  }

  // Validate required fields
  if (!payload.from || !payload.to) {
    return NextResponse.json(
      { error: "Missing required fields: from, to" },
      { status: 400 },
    );
  }

  if (!payload.attachments || !Array.isArray(payload.attachments)) {
    payload.attachments = [];
  }

  const result = await processInboundEmail(payload);

  if (!result.success) {
    return NextResponse.json(
      {
        error: result.error,
        submissionId: result.submissionId,
      },
      { status: 422 },
    );
  }

  return NextResponse.json(
    {
      submissionId: result.submissionId,
      documentCount: result.documentCount,
      message: "Submission created successfully from email",
    },
    { status: 201 },
  );
}
