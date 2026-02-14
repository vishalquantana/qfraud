import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, withTenantFilter } from "@/lib/rbac";

// ─── DELETE /api/webhooks/:id ───────────────────────────
// Deactivate a webhook subscription.

export const DELETE = withTenant(async (ctx, params) => {
  const { tenantId } = ctx;
  const id = params?.id;

  if (!id) {
    return NextResponse.json(
      { error: "Subscription ID is required" },
      { status: 400 },
    );
  }

  const subscription = await prisma.webhookSubscription.findFirst({
    where: withTenantFilter(tenantId, { id }),
  });

  if (!subscription) {
    return NextResponse.json(
      { error: "Webhook subscription not found" },
      { status: 404 },
    );
  }

  if (!subscription.isActive) {
    return NextResponse.json(
      { error: "Webhook subscription is already inactive" },
      { status: 400 },
    );
  }

  await prisma.webhookSubscription.update({
    where: { id: subscription.id },
    data: { isActive: false },
  });

  return NextResponse.json({
    data: { id: subscription.id, isActive: false },
  });
});
