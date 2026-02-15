import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Mock auth-middleware before importing rbac
vi.mock("@/lib/auth-middleware", () => ({
  extractAuth: vi.fn(),
  unauthorizedResponse: vi.fn(
    () => NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  ),
  forbiddenResponse: vi.fn(
    (msg?: string) => NextResponse.json({ error: msg || "Forbidden" }, { status: 403 })
  ),
}));

import { extractAuth, forbiddenResponse } from "@/lib/auth-middleware";
import { withRole, withTenant } from "@/lib/rbac";
import { TENANT, USERS } from "@/test/fixtures";

// ─── Helpers ──────────────────────────────────────────────

function createMockRequest(options: {
  url?: string;
  method?: string;
} = {}): any {
  return {
    url: options.url ?? "http://localhost:3000/api/config/thresholds",
    method: options.method ?? "GET",
    headers: new Headers(),
  };
}

const mockHandler = vi.fn(async (ctx) => {
  return NextResponse.json({ ok: true });
});

// ─── Tests ────────────────────────────────────────────────

describe("withRole: API key permission enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("API key WITH matching permissions", () => {
    it("allows API key with exact permission match", async () => {
      vi.mocked(extractAuth).mockResolvedValue({
        type: "apikey",
        apiKey: {
          tenantId: TENANT.id,
          apiKeyId: "key-001",
          permissions: ["ADMIN"],
        },
      });

      const handler = withRole(["ADMIN"], mockHandler);
      const res = await handler(createMockRequest());

      expect(mockHandler).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it("allows API key when one of multiple permissions matches", async () => {
      vi.mocked(extractAuth).mockResolvedValue({
        type: "apikey",
        apiKey: {
          tenantId: TENANT.id,
          apiKeyId: "key-002",
          permissions: ["UNDERWRITER", "SIU_INVESTIGATOR"],
        },
      });

      const handler = withRole(["UNDERWRITER", "ADMIN"], mockHandler);
      const res = await handler(createMockRequest());

      expect(mockHandler).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it("allows API key with wildcard '*' permission", async () => {
      vi.mocked(extractAuth).mockResolvedValue({
        type: "apikey",
        apiKey: {
          tenantId: TENANT.id,
          apiKeyId: "key-003",
          permissions: ["*"],
        },
      });

      const handler = withRole(["ADMIN"], mockHandler);
      const res = await handler(createMockRequest());

      expect(mockHandler).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });
  });

  describe("API key WITHOUT matching permissions", () => {
    it("denies API key with empty permissions array", async () => {
      vi.mocked(extractAuth).mockResolvedValue({
        type: "apikey",
        apiKey: {
          tenantId: TENANT.id,
          apiKeyId: "key-004",
          permissions: [],
        },
      });

      const handler = withRole(["ADMIN"], mockHandler);
      const res = await handler(createMockRequest());

      expect(mockHandler).not.toHaveBeenCalled();
      expect(res.status).toBe(403);
    });

    it("denies API key with non-matching permissions", async () => {
      vi.mocked(extractAuth).mockResolvedValue({
        type: "apikey",
        apiKey: {
          tenantId: TENANT.id,
          apiKeyId: "key-005",
          permissions: ["UNDERWRITER"],
        },
      });

      const handler = withRole(["ADMIN", "SENIOR_UNDERWRITER"], mockHandler);
      const res = await handler(createMockRequest());

      expect(mockHandler).not.toHaveBeenCalled();
      expect(res.status).toBe(403);
    });

    it("denies API key with BROKER permission trying to access ADMIN endpoint", async () => {
      vi.mocked(extractAuth).mockResolvedValue({
        type: "apikey",
        apiKey: {
          tenantId: TENANT.id,
          apiKeyId: "key-006",
          permissions: ["BROKER"],
        },
      });

      const handler = withRole(["ADMIN"], mockHandler);
      const res = await handler(createMockRequest());

      expect(mockHandler).not.toHaveBeenCalled();
      expect(res.status).toBe(403);
    });
  });

  describe("user auth still works as before", () => {
    it("allows user with matching role", async () => {
      vi.mocked(extractAuth).mockResolvedValue({
        type: "user",
        user: {
          id: USERS.admin.id,
          tenantId: TENANT.id,
          role: "ADMIN",
          name: USERS.admin.name,
          email: USERS.admin.email,
        },
      });

      const handler = withRole(["ADMIN"], mockHandler);
      const res = await handler(createMockRequest());

      expect(mockHandler).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it("denies user without matching role", async () => {
      vi.mocked(extractAuth).mockResolvedValue({
        type: "user",
        user: {
          id: USERS.broker.id,
          tenantId: TENANT.id,
          role: "BROKER",
          name: USERS.broker.name,
          email: USERS.broker.email,
        },
      });

      const handler = withRole(["ADMIN"], mockHandler);
      const res = await handler(createMockRequest());

      expect(mockHandler).not.toHaveBeenCalled();
      expect(res.status).toBe(403);
    });
  });

  describe("unauthenticated requests", () => {
    it("returns 401 when no auth context", async () => {
      vi.mocked(extractAuth).mockResolvedValue(null);

      const handler = withRole(["ADMIN"], mockHandler);
      const res = await handler(createMockRequest());

      expect(mockHandler).not.toHaveBeenCalled();
      expect(res.status).toBe(401);
    });
  });
});
