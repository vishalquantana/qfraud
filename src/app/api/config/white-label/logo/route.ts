import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/rbac";
import { type AuthUser } from "@/lib/auth-middleware";
import { logAudit } from "@/services/audit-log";
import { s3Client, BUCKET } from "@/lib/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";

const MAX_LOGO_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

// ─── POST /api/config/white-label/logo ──────────────────
// Upload a logo image for the tenant (ADMIN only)

export const POST = withRole(["ADMIN"], async (ctx) => {
  const formData = await ctx.req.formData();
  const file = formData.get("logo");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "No logo file provided" },
      { status: 400 },
    );
  }

  if (!ACCEPTED_TYPES.includes(file.type)) {
    return NextResponse.json(
      {
        error: `Invalid file type: ${file.type}. Accepted types: PNG, JPEG, SVG, WebP`,
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_LOGO_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum logo size is 5MB" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() ?? "png";
  const s3Key = `${ctx.tenantId}/branding/logo.${ext}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      Body: buffer,
      ContentType: file.type,
    }),
  );

  // Store the S3 key as the logoUrl (in production, this would be a CloudFront URL)
  const logoUrl = `https://${BUCKET}.s3.amazonaws.com/${s3Key}`;

  await prisma.whiteLabelConfig.upsert({
    where: { tenantId: ctx.tenantId },
    update: { logoUrl },
    create: { tenantId: ctx.tenantId, logoUrl },
  });

  // Audit log
  const authUser =
    ctx.auth.type === "user" ? (ctx.auth.user as AuthUser) : null;
  await logAudit({
    tenantId: ctx.tenantId,
    action: "THRESHOLD_CHANGED",
    details: {
      type: "white_label_logo_upload",
      fileName: file.name,
      fileSize: file.size,
      logoUrl,
    },
    userId: authUser?.id,
    ipAddress:
      ctx.req.headers.get("x-forwarded-for") ??
      ctx.req.headers.get("x-real-ip") ??
      undefined,
  });

  return NextResponse.json({ data: { logoUrl } });
});
