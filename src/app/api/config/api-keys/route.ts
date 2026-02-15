import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";
import { hashApiKey, type AuthUser } from "@/lib/auth-middleware";
import { logAudit } from "@/services/audit-log";

// ─── GET /api/config/api-keys ───────────────────────────
// List API keys for the tenant. Never returns the full key.

export const GET = withRole(["ADMIN"], async (ctx) => {
  const { tenantId } = ctx;

  const keys = await prisma.apiKey.findMany({
    where: withTenantFilter(tenantId),
    select: {
      id: true,
      name: true,
      key: true,
      isActive: true,
      permissions: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    data: keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.key.substring(0, 8),
      isActive: k.isActive,
      permissions: k.permissions,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
    })),
  });
});

// ─── POST /api/config/api-keys ──────────────────────────
// Create a new API key. Returns the full key ONCE.

export const POST = withRole(["ADMIN"], async (ctx) => {
  const { req, tenantId } = ctx;

  let body: { name?: string; permissions?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, permissions } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "name is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  // Generate a random API key: qsk_ prefix + 32 random bytes hex
  const rawKey = `qsk_${crypto.randomBytes(32).toString("hex")}`;
  const hashedKey = hashApiKey(rawKey);

  const apiKey = await prisma.apiKey.create({
    data: {
      tenantId,
      name: name.trim(),
      key: hashedKey,
      permissions: JSON.parse(
        JSON.stringify(Array.isArray(permissions) ? permissions : [])
      ),
    },
  });

  // Audit log
  const authUser =
    ctx.auth.type === "user" ? (ctx.auth.user as AuthUser) : null;
  await logAudit({
    tenantId,
    action: "THRESHOLD_CHANGED",
    details: {
      type: "api_key_created",
      keyId: apiKey.id,
      keyName: name.trim(),
    },
    userId: authUser?.id,
    ipAddress:
      ctx.req.headers.get("x-forwarded-for") ??
      ctx.req.headers.get("x-real-ip") ??
      undefined,
  });

  return NextResponse.json(
    {
      data: {
        id: apiKey.id,
        name: apiKey.name,
        key: rawKey, // Shown only once
        keyPrefix: hashedKey.substring(0, 8),
        isActive: apiKey.isActive,
        permissions: apiKey.permissions,
        createdAt: apiKey.createdAt,
      },
    },
    { status: 201 }
  );
});
