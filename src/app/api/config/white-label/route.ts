import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/rbac";
import { type AuthUser } from "@/lib/auth-middleware";
import { logAudit } from "@/services/audit-log";

// ─── GET /api/config/white-label ────────────────────────
// Get the current white-label configuration (ADMIN only)

export const GET = withRole(["ADMIN"], async (ctx) => {
  const config = await prisma.whiteLabelConfig.findUnique({
    where: { tenantId: ctx.tenantId },
  });

  if (!config) {
    // Return defaults
    return NextResponse.json({
      data: {
        logoUrl: null,
        primaryColor: "#1e40af",
        secondaryColor: "#3b82f6",
        accentColor: "#f59e0b",
        customDomain: null,
        customEmailDomain: null,
        termsUrl: null,
        privacyUrl: null,
        footerText: null,
        supportEmail: null,
        supportPhone: null,
      },
    });
  }

  return NextResponse.json({
    data: {
      logoUrl: config.logoUrl,
      primaryColor: config.primaryColor,
      secondaryColor: config.secondaryColor,
      accentColor: config.accentColor,
      customDomain: config.customDomain,
      customEmailDomain: config.customEmailDomain,
      termsUrl: config.termsUrl,
      privacyUrl: config.privacyUrl,
      footerText: config.footerText,
      supportEmail: config.supportEmail,
      supportPhone: config.supportPhone,
    },
  });
});

// ─── PUT /api/config/white-label ────────────────────────
// Update white-label configuration (ADMIN only)

export const PUT = withRole(["ADMIN"], async (ctx) => {
  const body = await ctx.req.json();

  const {
    primaryColor,
    secondaryColor,
    accentColor,
    customDomain,
    customEmailDomain,
    termsUrl,
    privacyUrl,
    footerText,
    supportEmail,
    supportPhone,
  } = body;

  // Validate hex colors
  const hexPattern = /^#[0-9a-fA-F]{6}$/;
  if (primaryColor && !hexPattern.test(primaryColor)) {
    return NextResponse.json(
      { error: "Invalid primaryColor. Must be a hex color (e.g., #1e40af)" },
      { status: 400 },
    );
  }
  if (secondaryColor && !hexPattern.test(secondaryColor)) {
    return NextResponse.json(
      { error: "Invalid secondaryColor. Must be a hex color (e.g., #3b82f6)" },
      { status: 400 },
    );
  }
  if (accentColor && !hexPattern.test(accentColor)) {
    return NextResponse.json(
      { error: "Invalid accentColor. Must be a hex color (e.g., #f59e0b)" },
      { status: 400 },
    );
  }

  // Get before state for audit log
  const before = await prisma.whiteLabelConfig.findUnique({
    where: { tenantId: ctx.tenantId },
  });

  const updateData = {
    ...(primaryColor !== undefined && { primaryColor }),
    ...(secondaryColor !== undefined && { secondaryColor }),
    ...(accentColor !== undefined && { accentColor }),
    ...(customDomain !== undefined && { customDomain: customDomain || null }),
    ...(customEmailDomain !== undefined && {
      customEmailDomain: customEmailDomain || null,
    }),
    ...(termsUrl !== undefined && { termsUrl: termsUrl || null }),
    ...(privacyUrl !== undefined && { privacyUrl: privacyUrl || null }),
    ...(footerText !== undefined && { footerText: footerText || null }),
    ...(supportEmail !== undefined && { supportEmail: supportEmail || null }),
    ...(supportPhone !== undefined && { supportPhone: supportPhone || null }),
  };

  const config = await prisma.whiteLabelConfig.upsert({
    where: { tenantId: ctx.tenantId },
    update: updateData,
    create: {
      tenantId: ctx.tenantId,
      ...updateData,
    },
  });

  // Audit log
  const authUser =
    ctx.auth.type === "user" ? (ctx.auth.user as AuthUser) : null;
  await logAudit({
    tenantId: ctx.tenantId,
    action: "THRESHOLD_CHANGED",
    details: {
      type: "white_label_config",
      before: before
        ? {
            primaryColor: before.primaryColor,
            secondaryColor: before.secondaryColor,
            accentColor: before.accentColor,
            customDomain: before.customDomain,
            customEmailDomain: before.customEmailDomain,
            termsUrl: before.termsUrl,
            privacyUrl: before.privacyUrl,
            footerText: before.footerText,
            supportEmail: before.supportEmail,
            supportPhone: before.supportPhone,
          }
        : null,
      after: {
        primaryColor: config.primaryColor,
        secondaryColor: config.secondaryColor,
        accentColor: config.accentColor,
        customDomain: config.customDomain,
        customEmailDomain: config.customEmailDomain,
        termsUrl: config.termsUrl,
        privacyUrl: config.privacyUrl,
        footerText: config.footerText,
        supportEmail: config.supportEmail,
        supportPhone: config.supportPhone,
      },
    },
    userId: authUser?.id,
    ipAddress:
      ctx.req.headers.get("x-forwarded-for") ??
      ctx.req.headers.get("x-real-ip") ??
      undefined,
  });

  return NextResponse.json({
    data: {
      logoUrl: config.logoUrl,
      primaryColor: config.primaryColor,
      secondaryColor: config.secondaryColor,
      accentColor: config.accentColor,
      customDomain: config.customDomain,
      customEmailDomain: config.customEmailDomain,
      termsUrl: config.termsUrl,
      privacyUrl: config.privacyUrl,
      footerText: config.footerText,
      supportEmail: config.supportEmail,
      supportPhone: config.supportPhone,
    },
  });
});
