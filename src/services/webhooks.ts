import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { withTenantFilter } from "@/lib/rbac";

// ─── Event Types ─────────────────────────────────────────

export type WebhookEventType =
  | "submission.processed"
  | "submission.approved"
  | "submission.declined"
  | "submission.escalated"
  | "fraud.flag_raised"
  | "siu.case_created";

export const VALID_EVENT_TYPES: WebhookEventType[] = [
  "submission.processed",
  "submission.approved",
  "submission.declined",
  "submission.escalated",
  "fraud.flag_raised",
  "siu.case_created",
];

// ─── HMAC Signing ────────────────────────────────────────

/**
 * Creates an HMAC-SHA256 signature for a webhook payload.
 */
export function signPayload(payload: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

/**
 * Generates a cryptographically random secret for webhook signing.
 */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString("hex")}`;
}

// ─── Webhook Delivery ────────────────────────────────────

interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Delivers a webhook event to a single subscription URL.
 * Retries up to 3 times with exponential backoff on failure.
 */
async function deliverToSubscription(
  url: string,
  secret: string,
  payload: WebhookPayload,
): Promise<{ success: boolean; attempts: number; lastError?: string }> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body, secret);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Webhook-Event": payload.event,
          "X-Webhook-Timestamp": payload.timestamp,
        },
        body,
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (response.ok) {
        return { success: true, attempts: attempt };
      }

      // Non-retryable status codes
      if (response.status >= 400 && response.status < 500) {
        return {
          success: false,
          attempts: attempt,
          lastError: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      // Server error — retry
      if (attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      } else {
        return {
          success: false,
          attempts: attempt,
          lastError: `HTTP ${response.status}: ${response.statusText}`,
        };
      }
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      } else {
        return {
          success: false,
          attempts: attempt,
          lastError:
            error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  }

  return { success: false, attempts: MAX_RETRIES, lastError: "Max retries exceeded" };
}

/**
 * Dispatches a webhook event to all active subscriptions for a tenant
 * that are subscribed to the given event type.
 */
export async function dispatchWebhookEvent(
  tenantId: string,
  event: WebhookEventType,
  data: Record<string, unknown>,
): Promise<void> {
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: withTenantFilter(tenantId, { isActive: true }),
  });

  // Filter subscriptions that listen for this event
  const matching = subscriptions.filter((sub) => {
    const events = sub.events as string[];
    return Array.isArray(events) && events.includes(event);
  });

  if (matching.length === 0) return;

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  // Fire all deliveries in parallel — don't block the main flow
  await Promise.allSettled(
    matching.map((sub) => deliverToSubscription(sub.url, sub.secret, payload)),
  );
}
