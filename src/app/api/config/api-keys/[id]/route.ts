import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";
import { type AuthUser } from "@/lib/auth-middleware";
import { logAudit } from "@/services/audit-log";

// ─── PATCH /api/config/api-keys/:id ─────────────────────
// Revoke an API key (soft-delete by setting isActive: false).

export const PATCH = withRole(["ADMIN"], async (ctx, params) => {
  const { tenantId } = ctx;
  const resolvedParams = await params;
  const keyId = resolvedParams?.id as string;

  if (!keyId) {
    return NextResponse.json(
      { error: "API key ID is required" },
      { status: 400 }
    );
  }

  // Find the key scoped to tenant
  const existingKey = await prisma.apiKey.findFirst({
    where: withTenantFilter(tenantId, { id: keyId }),
  });

  if (!existingKey) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  if (!existingKey.isActive) {
    return NextResponse.json(
      { error: "API key is already revoked" },
      { status: 400 }
    );
  }

  // Revoke the key
  await prisma.apiKey.update({
    where: { id: keyId },
    data: { isActive: false },
  });

  // Audit log
  const authUser =
    ctx.auth.type === "user" ? (ctx.auth.user as AuthUser) : null;
  await logAudit({
    tenantId,
    action: "THRESHOLD_CHANGED",
    details: {
      type: "api_key_revoked",
      keyId: existingKey.id,
      keyName: existingKey.name,
    },
    userId: authUser?.id,
    ipAddress:
      ctx.req.headers.get("x-forwarded-for") ??
      ctx.req.headers.get("x-real-ip") ??
      undefined,
  });

  return NextResponse.json({
    data: { id: keyId, isActive: false },
  });
});
