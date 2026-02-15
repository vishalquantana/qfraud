import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  signPayload,
  generateWebhookSecret,
  dispatchWebhookEvent,
} from "@/services/webhooks";
import { TENANT } from "@/test/fixtures";

const mockedPrisma = vi.mocked(prisma);

// ─── Tests ────────────────────────────────────────────────

describe("webhooks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ------------------------------------------------------------------
  // signPayload()
  // ------------------------------------------------------------------

  describe("signPayload", () => {
    it("produces a deterministic HMAC-SHA256 hex digest", () => {
      const payload = '{"event":"submission.processed","data":{}}';
      const secret = "test-secret-key";

      const sig1 = signPayload(payload, secret);
      const sig2 = signPayload(payload, secret);

      expect(sig1).toBe(sig2);
    });

    it("matches a known HMAC-SHA256 computation", () => {
      const payload = '{"test":"data"}';
      const secret = "mysecret";

      const expected = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");

      expect(signPayload(payload, secret)).toBe(expected);
    });

    it("returns a 64-character hex string (SHA-256 produces 32 bytes)", () => {
      const sig = signPayload("hello", "key");
      expect(sig).toHaveLength(64);
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces different signatures for different payloads", () => {
      const secret = "same-secret";
      const sig1 = signPayload("payload-a", secret);
      const sig2 = signPayload("payload-b", secret);

      expect(sig1).not.toBe(sig2);
    });

    it("produces different signatures for different secrets", () => {
      const payload = "same-payload";
      const sig1 = signPayload(payload, "secret-1");
      const sig2 = signPayload(payload, "secret-2");

      expect(sig1).not.toBe(sig2);
    });
  });

  // ------------------------------------------------------------------
  // generateWebhookSecret()
  // ------------------------------------------------------------------

  describe("generateWebhookSecret", () => {
    it("starts with 'whsec_' prefix", () => {
      const secret = generateWebhookSecret();
      expect(secret.startsWith("whsec_")).toBe(true);
    });

    it("has proper length (whsec_ prefix + 64 hex chars from 32 random bytes)", () => {
      const secret = generateWebhookSecret();
      // "whsec_" = 6 chars, 32 bytes = 64 hex chars -> total 70
      expect(secret).toHaveLength(6 + 64);
    });

    it("contains only valid hex characters after prefix", () => {
      const secret = generateWebhookSecret();
      const hexPart = secret.slice(6);
      expect(hexPart).toMatch(/^[0-9a-f]{64}$/);
    });

    it("generates unique secrets on each call", () => {
      const secret1 = generateWebhookSecret();
      const secret2 = generateWebhookSecret();
      expect(secret1).not.toBe(secret2);
    });
  });

  // ------------------------------------------------------------------
  // deliverToSubscription() (tested indirectly via dispatchWebhookEvent)
  // ------------------------------------------------------------------

  describe("delivery behavior (via dispatchWebhookEvent)", () => {
    const mockSubscription = {
      id: "ws-1",
      tenantId: TENANT.id,
      url: "https://example.com/webhook",
      secret: "whsec_testsecret1234567890abcdef1234567890abcdef1234567890abcdef12",
      events: ["submission.processed"],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("delivers successfully on HTTP 200", async () => {
      mockedPrisma.webhookSubscription.findMany.mockResolvedValue([
        mockSubscription,
      ] as any);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", fetchMock);

      await dispatchWebhookEvent(TENANT.id, "submission.processed", {
        submissionId: "sub-1",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        mockSubscription.url,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Webhook-Event": "submission.processed",
          }),
        })
      );

      vi.unstubAllGlobals();
    });

    it("sends X-Webhook-Signature header with valid HMAC", async () => {
      mockedPrisma.webhookSubscription.findMany.mockResolvedValue([
        mockSubscription,
      ] as any);

      let capturedHeaders: Record<string, string> = {};
      let capturedBody = "";
      const fetchMock = vi.fn().mockImplementation((_url, opts) => {
        capturedHeaders = opts.headers;
        capturedBody = opts.body;
        return Promise.resolve({ ok: true, status: 200, statusText: "OK" });
      });
      vi.stubGlobal("fetch", fetchMock);

      await dispatchWebhookEvent(TENANT.id, "submission.processed", {
        submissionId: "sub-1",
      });

      // The signature should match the body signed with the subscription secret
      const expectedSig = signPayload(capturedBody, mockSubscription.secret);
      expect(capturedHeaders["X-Webhook-Signature"]).toBe(expectedSig);

      vi.unstubAllGlobals();
    });

    it("retries on HTTP 500 (server error)", async () => {
      mockedPrisma.webhookSubscription.findMany.mockResolvedValue([
        mockSubscription,
      ] as any);

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" })
        .mockResolvedValueOnce({ ok: false, status: 502, statusText: "Bad Gateway" })
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" });
      vi.stubGlobal("fetch", fetchMock);

      await dispatchWebhookEvent(TENANT.id, "submission.processed", {
        submissionId: "sub-1",
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);

      vi.unstubAllGlobals();
    });

    it("does NOT retry on 4xx client errors", async () => {
      mockedPrisma.webhookSubscription.findMany.mockResolvedValue([
        mockSubscription,
      ] as any);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });
      vi.stubGlobal("fetch", fetchMock);

      await dispatchWebhookEvent(TENANT.id, "submission.processed", {
        submissionId: "sub-1",
      });

      // Should only attempt once - no retry on 4xx
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });

    it("retries on network errors", async () => {
      mockedPrisma.webhookSubscription.findMany.mockResolvedValue([
        mockSubscription,
      ] as any);

      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ETIMEDOUT"))
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" });
      vi.stubGlobal("fetch", fetchMock);

      await dispatchWebhookEvent(TENANT.id, "submission.processed", {
        submissionId: "sub-1",
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);

      vi.unstubAllGlobals();
    });

    it("exhausts all 3 retry attempts on persistent server errors", async () => {
      mockedPrisma.webhookSubscription.findMany.mockResolvedValue([
        mockSubscription,
      ] as any);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      });
      vi.stubGlobal("fetch", fetchMock);

      await dispatchWebhookEvent(TENANT.id, "submission.processed", {
        submissionId: "sub-1",
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);

      vi.unstubAllGlobals();
    });
  });

  // ------------------------------------------------------------------
  // dispatchWebhookEvent()
  // ------------------------------------------------------------------

  describe("dispatchWebhookEvent", () => {
    it("filters subscriptions by event type", async () => {
      const matchingSub = {
        id: "ws-match",
        tenantId: TENANT.id,
        url: "https://example.com/match",
        secret: "whsec_match",
        events: ["submission.processed", "submission.approved"],
        isActive: true,
      };
      const nonMatchingSub = {
        id: "ws-nomatch",
        tenantId: TENANT.id,
        url: "https://example.com/nomatch",
        secret: "whsec_nomatch",
        events: ["submission.declined"],
        isActive: true,
      };

      mockedPrisma.webhookSubscription.findMany.mockResolvedValue([
        matchingSub,
        nonMatchingSub,
      ] as any);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", fetchMock);

      await dispatchWebhookEvent(TENANT.id, "submission.processed", {
        id: "sub-1",
      });

      // Only the matching subscription should receive the webhook
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.com/match",
        expect.anything()
      );

      vi.unstubAllGlobals();
    });

    it("skips inactive subscriptions (via prisma query filter)", async () => {
      mockedPrisma.webhookSubscription.findMany.mockResolvedValue([]);

      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await dispatchWebhookEvent(TENANT.id, "submission.processed", {});

      // No subscriptions returned -> no fetch calls
      expect(fetchMock).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("does nothing when no subscriptions match the event type", async () => {
      mockedPrisma.webhookSubscription.findMany.mockResolvedValue([
        {
          id: "ws-1",
          tenantId: TENANT.id,
          url: "https://example.com/hook",
          secret: "whsec_test",
          events: ["submission.declined"],
          isActive: true,
        },
      ] as any);

      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await dispatchWebhookEvent(TENANT.id, "submission.processed", {});

      expect(fetchMock).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("delivers to multiple matching subscriptions in parallel", async () => {
      const sub1 = {
        id: "ws-1",
        tenantId: TENANT.id,
        url: "https://example1.com/hook",
        secret: "whsec_s1",
        events: ["submission.processed"],
        isActive: true,
      };
      const sub2 = {
        id: "ws-2",
        tenantId: TENANT.id,
        url: "https://example2.com/hook",
        secret: "whsec_s2",
        events: ["submission.processed"],
        isActive: true,
      };

      mockedPrisma.webhookSubscription.findMany.mockResolvedValue([
        sub1,
        sub2,
      ] as any);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", fetchMock);

      await dispatchWebhookEvent(TENANT.id, "submission.processed", {});

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const urls = fetchMock.mock.calls.map((call: any[]) => call[0]);
      expect(urls).toContain("https://example1.com/hook");
      expect(urls).toContain("https://example2.com/hook");

      vi.unstubAllGlobals();
    });

    it("includes event, timestamp, and data in the payload body", async () => {
      mockedPrisma.webhookSubscription.findMany.mockResolvedValue([
        {
          id: "ws-1",
          tenantId: TENANT.id,
          url: "https://example.com/hook",
          secret: "whsec_test",
          events: ["fraud.flag_raised"],
          isActive: true,
        },
      ] as any);

      let capturedBody = "";
      const fetchMock = vi.fn().mockImplementation((_url, opts) => {
        capturedBody = opts.body;
        return Promise.resolve({ ok: true, status: 200, statusText: "OK" });
      });
      vi.stubGlobal("fetch", fetchMock);

      const eventData = { indicatorId: "fi-1", severity: "CRITICAL" };
      await dispatchWebhookEvent(TENANT.id, "fraud.flag_raised", eventData);

      const parsed = JSON.parse(capturedBody);
      expect(parsed.event).toBe("fraud.flag_raised");
      expect(parsed.timestamp).toBeDefined();
      expect(typeof parsed.timestamp).toBe("string");
      expect(parsed.data).toEqual(eventData);

      vi.unstubAllGlobals();
    });

    it("does not throw when a delivery fails (uses Promise.allSettled)", async () => {
      mockedPrisma.webhookSubscription.findMany.mockResolvedValue([
        {
          id: "ws-1",
          tenantId: TENANT.id,
          url: "https://failing.com/hook",
          secret: "whsec_test",
          events: ["submission.processed"],
          isActive: true,
        },
      ] as any);

      const fetchMock = vi.fn().mockRejectedValue(new Error("Network down"));
      vi.stubGlobal("fetch", fetchMock);

      // Should not throw
      await expect(
        dispatchWebhookEvent(TENANT.id, "submission.processed", {})
      ).resolves.toBeUndefined();

      vi.unstubAllGlobals();
    });

    it("queries subscriptions with tenant filter and isActive: true", async () => {
      mockedPrisma.webhookSubscription.findMany.mockResolvedValue([]);

      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await dispatchWebhookEvent(TENANT.id, "submission.processed", {});

      expect(mockedPrisma.webhookSubscription.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tenantId: TENANT.id,
          isActive: true,
        }),
      });

      vi.unstubAllGlobals();
    });
  });
});
