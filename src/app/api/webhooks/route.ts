import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, withTenantFilter } from "@/lib/rbac";
import {
  generateWebhookSecret,
  VALID_EVENT_TYPES,
  type WebhookEventType,
} from "@/services/webhooks";

// ─── POST /api/webhooks ─────────────────────────────────
// Create a new webhook subscription. Returns the secret once.

export const POST = withTenant(async (ctx) => {
  const { req, tenantId } = ctx;

  let body: { url?: string; events?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url, events } = body;

  // Validate URL
  if (!url || typeof url !== "string") {
    return NextResponse.json(
      { error: "url is required and must be a string" },
      { status: 400 },
    );
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json(
      { error: "url must be a valid URL" },
      { status: 400 },
    );
  }

  // Validate events
  if (!events || !Array.isArray(events) || events.length === 0) {
    return NextResponse.json(
      { error: "events is required and must be a non-empty array" },
      { status: 400 },
    );
  }

  const invalidEvents = events.filter(
    (e) => !VALID_EVENT_TYPES.includes(e as WebhookEventType),
  );
  if (invalidEvents.length > 0) {
    return NextResponse.json(
      {
        error: `Invalid event types: ${invalidEvents.join(", ")}. Valid types: ${VALID_EVENT_TYPES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const secret = generateWebhookSecret();

  const subscription = await prisma.webhookSubscription.create({
    data: {
      tenantId,
      url,
      events: JSON.parse(JSON.stringify(events)),
      secret,
    },
  });

  return NextResponse.json(
    {
      data: {
        id: subscription.id,
        url: subscription.url,
        events: subscription.events,
        secret, // Shown only once on creation
        isActive: subscription.isActive,
        createdAt: subscription.createdAt,
      },
    },
    { status: 201 },
  );
});

// ─── GET /api/webhooks ──────────────────────────────────
// List active webhook subscriptions for the tenant.

export const GET = withTenant(async (ctx) => {
  const { tenantId } = ctx;

  const subscriptions = await prisma.webhookSubscription.findMany({
    where: withTenantFilter(tenantId, { isActive: true }),
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    data: subscriptions.map((sub) => ({
      id: sub.id,
      url: sub.url,
      events: sub.events,
      isActive: sub.isActive,
      createdAt: sub.createdAt,
    })),
  });
});
