import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";
import { getUserId } from "@/lib/api-handler";
import { logAudit } from "@/services/audit-log";

// ─── PUT /api/config/thresholds/:lineOfBusiness ──────────
// Set per-LOB threshold override. Requires ADMIN role.

export const PUT = withRole(["ADMIN"], async (ctx, params) => {
  const { req, auth, tenantId } = ctx;
  const lineOfBusiness = params?.lineOfBusiness;
  if (!lineOfBusiness) {
    return NextResponse.json(
      { error: "Line of business is required" },
      { status: 400 }
    );
  }

  const lob = decodeURIComponent(lineOfBusiness).trim();
  if (!lob) {
    return NextResponse.json(
      { error: "Line of business cannot be empty" },
      { status: 400 }
    );
  }

  let body: {
    autoApproveBelow?: number;
    autoEscalateAbove?: number;
    siuReferralOnCritical?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { autoApproveBelow, autoEscalateAbove, siuReferralOnCritical } = body;

  // Validate values
  if (autoApproveBelow !== undefined) {
    if (
      typeof autoApproveBelow !== "number" ||
      autoApproveBelow < 0 ||
      autoApproveBelow > 100
    ) {
      return NextResponse.json(
        { error: "autoApproveBelow must be a number between 0 and 100" },
        { status: 400 }
      );
    }
  }

  if (autoEscalateAbove !== undefined) {
    if (
      typeof autoEscalateAbove !== "number" ||
      autoEscalateAbove < 0 ||
      autoEscalateAbove > 100
    ) {
      return NextResponse.json(
        { error: "autoEscalateAbove must be a number between 0 and 100" },
        { status: 400 }
      );
    }
  }

  if (
    siuReferralOnCritical !== undefined &&
    typeof siuReferralOnCritical !== "boolean"
  ) {
    return NextResponse.json(
      { error: "siuReferralOnCritical must be a boolean" },
      { status: 400 }
    );
  }

  // Find existing per-LOB config
  const existing = await prisma.thresholdConfig.findFirst({
    where: withTenantFilter(tenantId, { lineOfBusiness: lob }),
  });

  const beforeValues = existing
    ? {
        autoApproveBelow: existing.autoApproveBelow,
        autoEscalateAbove: existing.autoEscalateAbove,
        siuReferralOnCritical: existing.siuReferralOnCritical,
      }
    : null;

  // Cross-validation
  const effectiveApproveBelow =
    autoApproveBelow ?? (existing?.autoApproveBelow ?? 20);
  const effectiveEscalateAbove =
    autoEscalateAbove ?? (existing?.autoEscalateAbove ?? 70);
  if (effectiveApproveBelow >= effectiveEscalateAbove) {
    return NextResponse.json(
      { error: "autoApproveBelow must be less than autoEscalateAbove" },
      { status: 400 }
    );
  }

  const updateData = {
    autoApproveBelow: autoApproveBelow ?? 20,
    autoEscalateAbove: autoEscalateAbove ?? 70,
    siuReferralOnCritical: siuReferralOnCritical ?? true,
  };

  let config;
  if (existing) {
    config = await prisma.thresholdConfig.update({
      where: { id: existing.id },
      data: updateData,
    });
  } else {
    config = await prisma.thresholdConfig.create({
      data: {
        tenantId,
        lineOfBusiness: lob,
        ...updateData,
      },
    });
  }

  // Audit log
  const userId = getUserId(auth);
  const ipAddress =
    ctx.req.headers.get("x-forwarded-for") ??
    ctx.req.headers.get("x-real-ip") ??
    null;

  await logAudit({
    tenantId,
    action: "THRESHOLD_CHANGED",
    details: {
      scope: "lineOfBusiness",
      lineOfBusiness: lob,
      operation: beforeValues ? "update" : "create",
      before: beforeValues,
      after: {
        autoApproveBelow: config.autoApproveBelow,
        autoEscalateAbove: config.autoEscalateAbove,
        siuReferralOnCritical: config.siuReferralOnCritical,
      },
    },
    userId,
    ipAddress,
  });

  return NextResponse.json({
    data: {
      id: config.id,
      lineOfBusiness: config.lineOfBusiness,
      autoApproveBelow: config.autoApproveBelow,
      autoEscalateAbove: config.autoEscalateAbove,
      siuReferralOnCritical: config.siuReferralOnCritical,
      updatedAt: config.updatedAt,
    },
  });
});

// ─── DELETE /api/config/thresholds/:lineOfBusiness ───────
// Remove per-LOB override (falls back to global). Requires ADMIN role.

export const DELETE = withRole(["ADMIN"], async (ctx, params) => {
  const { auth, tenantId } = ctx;
  const lineOfBusiness = params?.lineOfBusiness;
  if (!lineOfBusiness) {
    return NextResponse.json(
      { error: "Line of business is required" },
      { status: 400 }
    );
  }

  const lob = decodeURIComponent(lineOfBusiness).trim();

  // Find existing per-LOB config
  const existing = await prisma.thresholdConfig.findFirst({
    where: withTenantFilter(tenantId, { lineOfBusiness: lob }),
  });

  if (!existing) {
    return NextResponse.json(
      { error: `No threshold override found for line of business: ${lob}` },
      { status: 404 }
    );
  }

  await prisma.thresholdConfig.delete({
    where: { id: existing.id },
  });

  // Audit log
  const userId = getUserId(auth);
  const ipAddress =
    ctx.req.headers.get("x-forwarded-for") ??
    ctx.req.headers.get("x-real-ip") ??
    null;

  await logAudit({
    tenantId,
    action: "THRESHOLD_CHANGED",
    details: {
      scope: "lineOfBusiness",
      lineOfBusiness: lob,
      operation: "delete",
      before: {
        autoApproveBelow: existing.autoApproveBelow,
        autoEscalateAbove: existing.autoEscalateAbove,
        siuReferralOnCritical: existing.siuReferralOnCritical,
      },
      after: null,
    },
    userId,
    ipAddress,
  });

  return NextResponse.json({
    data: {
      deleted: true,
      lineOfBusiness: lob,
      message: `Threshold override for '${lob}' removed. Global thresholds will apply.`,
    },
  });
});
