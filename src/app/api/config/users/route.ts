import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";
import { type AuthUser } from "@/lib/auth-middleware";
import { logAudit } from "@/services/audit-log";
import { sendNotification } from "@/services/notification";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// ─── GET /api/config/users ──────────────────────────────
// List all users for the current tenant (ADMIN only)

export const GET = withRole(["ADMIN"], async (ctx) => {
  const users = await prisma.user.findMany({
    where: withTenantFilter(ctx.tenantId),
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Count active underwriters for summary
  const activeUnderwriters = users.filter(
    (u) =>
      u.isActive &&
      (u.role === "UNDERWRITER" || u.role === "SENIOR_UNDERWRITER"),
  ).length;

  return NextResponse.json({
    data: {
      users,
      summary: {
        total: users.length,
        active: users.filter((u) => u.isActive).length,
        activeUnderwriters,
      },
    },
  });
});

// ─── POST /api/config/users ─────────────────────────────
// Invite a new user (ADMIN only)

const VALID_ROLES = [
  "ADMIN",
  "UNDERWRITER",
  "SENIOR_UNDERWRITER",
  "SIU_INVESTIGATOR",
  "COMPLIANCE_OFFICER",
  "BROKER",
];

export const POST = withRole(["ADMIN"], async (ctx) => {
  const body = await ctx.req.json();
  const { email, name, role } = body as {
    email?: string;
    name?: string;
    role?: string;
  };

  if (!email || !name || !role) {
    return NextResponse.json(
      { error: "email, name, and role are required" },
      { status: 400 },
    );
  }

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json(
      { error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` },
      { status: 400 },
    );
  }

  // Check for existing user with same email in this tenant
  const existing = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: ctx.tenantId, email } },
  });

  if (existing) {
    return NextResponse.json(
      { error: "A user with this email already exists in your organization" },
      { status: 409 },
    );
  }

  // Generate a temporary password (user would reset via email link in production)
  const tempPassword = crypto.randomBytes(16).toString("hex");
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const user = await prisma.user.create({
    data: {
      tenantId: ctx.tenantId,
      email,
      name,
      role: role as "ADMIN" | "UNDERWRITER" | "SENIOR_UNDERWRITER" | "SIU_INVESTIGATOR" | "COMPLIANCE_OFFICER" | "BROKER",
      passwordHash,
      isActive: true,
    },
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
  const authUser = ctx.auth.type === "user" ? (ctx.auth.user as AuthUser) : null;
  await logAudit({
    tenantId: ctx.tenantId,
    action: "USER_LOGIN", // Closest existing action type for user management
    details: {
      action: "USER_INVITED",
      invitedUserId: user.id,
      invitedEmail: email,
      invitedRole: role,
      invitedBy: authUser?.name ?? "API",
    },
    userId: authUser?.id,
    ipAddress:
      ctx.req.headers.get("x-forwarded-for") ??
      ctx.req.headers.get("x-real-ip"),
  });

  // Send invitation email (fire-and-forget)
  sendNotification("SUBMISSION_RECEIVED", email, ctx.tenantId, {
    insuredName: name,
    trackingUrl: `${process.env.NEXTAUTH_URL ?? ""}/dashboard/login`,
  }).catch(() => {
    // Silent failure for email
  });

  return NextResponse.json({ data: user }, { status: 201 });
});
