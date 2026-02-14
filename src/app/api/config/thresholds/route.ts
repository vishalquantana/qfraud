import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";
import { getUserId } from "@/lib/api-handler";
import { logAudit } from "@/services/audit-log";

// ─── GET /api/config/thresholds ──────────────────────────
// Returns the current threshold config for the tenant (global + per-LOB overrides)

export const GET = withRole(["ADMIN"], async (ctx) => {
  const { tenantId } = ctx;

  const configs = await prisma.thresholdConfig.findMany({
    where: withTenantFilter(tenantId),
    orderBy: { createdAt: "asc" },
  });

  const global = configs.find((c) => c.lineOfBusiness === null);
  const overrides = configs.filter((c) => c.lineOfBusiness !== null);

  return NextResponse.json({
    data: {
      global: global
        ? {
            id: global.id,
            autoApproveBelow: global.autoApproveBelow,
            autoEscalateAbove: global.autoEscalateAbove,
            siuReferralOnCritical: global.siuReferralOnCritical,
            updatedAt: global.updatedAt,
          }
        : {
            autoApproveBelow: 20,
            autoEscalateAbove: 70,
            siuReferralOnCritical: true,
          },
      overrides: overrides.map((o) => ({
        id: o.id,
        lineOfBusiness: o.lineOfBusiness,
        autoApproveBelow: o.autoApproveBelow,
        autoEscalateAbove: o.autoEscalateAbove,
        siuReferralOnCritical: o.siuReferralOnCritical,
        updatedAt: o.updatedAt,
      })),
    },
  });
});

// ─── PUT /api/config/thresholds ──────────────────────────
// Update global thresholds. Requires ADMIN role.

export const PUT = withRole(["ADMIN"], async (ctx) => {
  const { req, auth, tenantId } = ctx;

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

  // Find existing global config
  const existing = await prisma.thresholdConfig.findFirst({
    where: withTenantFilter(tenantId, { lineOfBusiness: null }),
  });

  const beforeValues = existing
    ? {
        autoApproveBelow: existing.autoApproveBelow,
        autoEscalateAbove: existing.autoEscalateAbove,
        siuReferralOnCritical: existing.siuReferralOnCritical,
      }
    : { autoApproveBelow: 20, autoEscalateAbove: 70, siuReferralOnCritical: true };

  // Cross-validation: approve below should be less than escalate above
  const effectiveApproveBelow = autoApproveBelow ?? beforeValues.autoApproveBelow;
  const effectiveEscalateAbove = autoEscalateAbove ?? beforeValues.autoEscalateAbove;
  if (effectiveApproveBelow >= effectiveEscalateAbove) {
    return NextResponse.json(
      {
        error:
          "autoApproveBelow must be less than autoEscalateAbove",
      },
      { status: 400 }
    );
  }

  const updateData: {
    autoApproveBelow?: number;
    autoEscalateAbove?: number;
    siuReferralOnCritical?: boolean;
  } = {};
  if (autoApproveBelow !== undefined) updateData.autoApproveBelow = autoApproveBelow;
  if (autoEscalateAbove !== undefined) updateData.autoEscalateAbove = autoEscalateAbove;
  if (siuReferralOnCritical !== undefined)
    updateData.siuReferralOnCritical = siuReferralOnCritical;

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
        lineOfBusiness: null,
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
      scope: "global",
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
      autoApproveBelow: config.autoApproveBelow,
      autoEscalateAbove: config.autoEscalateAbove,
      siuReferralOnCritical: config.siuReferralOnCritical,
      updatedAt: config.updatedAt,
    },
  });
});
