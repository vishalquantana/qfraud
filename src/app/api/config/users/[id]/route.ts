import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";
import { type AuthUser } from "@/lib/auth-middleware";
import { logAudit } from "@/services/audit-log";

const VALID_ROLES = [
  "ADMIN",
  "UNDERWRITER",
  "SENIOR_UNDERWRITER",
  "SIU_INVESTIGATOR",
  "COMPLIANCE_OFFICER",
  "BROKER",
];

// ─── PATCH /api/config/users/:id ────────────────────────
// Edit a user: change role or activate/deactivate (ADMIN only)

export const PATCH = withRole(["ADMIN"], async (ctx, params) => {
  const userId = params?.id;
  if (!userId) {
    return NextResponse.json({ error: "User ID required" }, { status: 400 });
  }

  const body = await ctx.req.json();
  const { role, isActive } = body as {
    role?: string;
    isActive?: boolean;
  };

  // Fetch the target user (scoped to tenant)
  const targetUser = await prisma.user.findFirst({
    where: withTenantFilter(ctx.tenantId, { id: userId }),
  });

  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Prevent self-deactivation
  const authUser = ctx.auth.type === "user" ? (ctx.auth.user as AuthUser) : null;
  if (isActive === false && authUser?.id === targetUser.id) {
    return NextResponse.json(
      { error: "You cannot deactivate yourself" },
      { status: 400 },
    );
  }

  // Validate role if provided
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return NextResponse.json(
      { error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` },
      { status: 400 },
    );
  }

  // Build update data
  const updateData: Record<string, unknown> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (role !== undefined && role !== targetUser.role) {
    updateData.role = role;
    changes.role = { from: targetUser.role, to: role };
  }

  if (isActive !== undefined && isActive !== targetUser.isActive) {
    updateData.isActive = isActive;
    changes.isActive = { from: targetUser.isActive, to: isActive };
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "No changes provided" },
      { status: 400 },
    );
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  // Audit log
  await logAudit({
    tenantId: ctx.tenantId,
    action: "USER_LOGIN", // Closest existing action type
    details: {
      action: "USER_UPDATED",
      targetUserId: userId,
      targetEmail: targetUser.email,
      changes,
      updatedBy: authUser?.name ?? "API",
    },
    userId: authUser?.id,
    ipAddress:
      ctx.req.headers.get("x-forwarded-for") ??
      ctx.req.headers.get("x-real-ip"),
  });

  return NextResponse.json({ data: updated });
});
