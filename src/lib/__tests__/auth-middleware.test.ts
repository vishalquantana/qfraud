import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import {
  hashApiKey,
  extractAuth,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/auth-middleware";
import { USERS, TENANT } from "@/test/fixtures";

// ─── Mocks ───────────────────────────────────────────────

// Mock next-auth/jwt
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

// Prisma is already mocked globally by src/test/setup.ts

import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";

/**
 * Helper to create a minimal NextRequest-like object for testing.
 */
function createMockRequest(options: {
  headers?: Record<string, string>;
  url?: string;
}): any {
  const headers = new Map(Object.entries(options.headers ?? {}));
  return {
    url: options.url ?? "https://acme.quantanashield.com/api/test",
    headers: {
      get: (key: string) => headers.get(key) ?? null,
    },
  };
}

// ─── hashApiKey() ────────────────────────────────────────

describe("hashApiKey", () => {
  it("should return a deterministic SHA-256 hex digest", () => {
    const key = "qs_live_abc123def456";
    const expected = crypto.createHash("sha256").update(key).digest("hex");
    expect(hashApiKey(key)).toBe(expected);
  });

  it("should produce the same hash for the same input", () => {
    const key = "qs_test_repeat_key";
    const hash1 = hashApiKey(key);
    const hash2 = hashApiKey(key);
    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different inputs", () => {
    const hash1 = hashApiKey("key-one");
    const hash2 = hashApiKey("key-two");
    expect(hash1).not.toBe(hash2);
  });

  it("should return a 64-character hex string (SHA-256 output)", () => {
    const hash = hashApiKey("some-api-key");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should handle empty string input", () => {
    const expected = crypto.createHash("sha256").update("").digest("hex");
    expect(hashApiKey("")).toBe(expected);
  });

  it("should handle very long key input", () => {
    const longKey = "x".repeat(10000);
    const expected = crypto.createHash("sha256").update(longKey).digest("hex");
    const hash = hashApiKey(longKey);
    expect(hash).toBe(expected);
    expect(hash).toHaveLength(64);
  });

  it("should handle special characters in key", () => {
    const specialKey = "qs_!@#$%^&*()_+-=[]{}|;':\",./<>?";
    const expected = crypto.createHash("sha256").update(specialKey).digest("hex");
    expect(hashApiKey(specialKey)).toBe(expected);
  });

  it("should be case-sensitive", () => {
    const hashLower = hashApiKey("abcdef");
    const hashUpper = hashApiKey("ABCDEF");
    expect(hashLower).not.toBe(hashUpper);
  });
});

// ─── extractAuth() ───────────────────────────────────────

describe("extractAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("JWT token extraction", () => {
    it("should return user auth context when JWT token has all required fields", async () => {
      const mockToken = {
        id: USERS.admin.id,
        tenantId: TENANT.id,
        role: USERS.admin.role,
        name: USERS.admin.name,
        email: USERS.admin.email,
      };
      vi.mocked(getToken).mockResolvedValue(mockToken as any);

      const req = createMockRequest({});
      const result = await extractAuth(req);

      expect(result).toEqual({
        type: "user",
        user: {
          id: USERS.admin.id,
          tenantId: TENANT.id,
          role: "ADMIN",
          name: USERS.admin.name,
          email: USERS.admin.email,
        },
      });
    });

    it("should return user auth context for a broker user", async () => {
      const mockToken = {
        id: USERS.broker.id,
        tenantId: TENANT.id,
        role: USERS.broker.role,
        name: USERS.broker.name,
        email: USERS.broker.email,
      };
      vi.mocked(getToken).mockResolvedValue(mockToken as any);

      const req = createMockRequest({});
      const result = await extractAuth(req);

      expect(result).toEqual({
        type: "user",
        user: {
          id: USERS.broker.id,
          tenantId: TENANT.id,
          role: "BROKER",
          name: USERS.broker.name,
          email: USERS.broker.email,
        },
      });
    });

    it("should default name to empty string when token name is null", async () => {
      const mockToken = {
        id: USERS.underwriter.id,
        tenantId: TENANT.id,
        role: USERS.underwriter.role,
        name: null,
        email: USERS.underwriter.email,
      };
      vi.mocked(getToken).mockResolvedValue(mockToken as any);

      const req = createMockRequest({});
      const result = await extractAuth(req);

      expect(result).not.toBeNull();
      expect(result!.type).toBe("user");
      if (result!.type === "user") {
        expect(result!.user.name).toBe("");
      }
    });

    it("should default email to empty string when token email is null", async () => {
      const mockToken = {
        id: USERS.underwriter.id,
        tenantId: TENANT.id,
        role: USERS.underwriter.role,
        name: USERS.underwriter.name,
        email: null,
      };
      vi.mocked(getToken).mockResolvedValue(mockToken as any);

      const req = createMockRequest({});
      const result = await extractAuth(req);

      expect(result).not.toBeNull();
      expect(result!.type).toBe("user");
      if (result!.type === "user") {
        expect(result!.user.email).toBe("");
      }
    });

    it("should not fall through to API key check when JWT is valid", async () => {
      const mockToken = {
        id: USERS.admin.id,
        tenantId: TENANT.id,
        role: USERS.admin.role,
        name: USERS.admin.name,
        email: USERS.admin.email,
      };
      vi.mocked(getToken).mockResolvedValue(mockToken as any);

      const req = createMockRequest({
        headers: { "x-api-key": "should-be-ignored" },
      });
      const result = await extractAuth(req);

      expect(result!.type).toBe("user");
      expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("JWT token missing required fields", () => {
    it("should not return user auth when token is missing id", async () => {
      const mockToken = {
        tenantId: TENANT.id,
        role: "ADMIN",
        name: "Admin",
        email: "admin@test.com",
      };
      vi.mocked(getToken).mockResolvedValue(mockToken as any);

      const req = createMockRequest({});
      const result = await extractAuth(req);

      // With no API key header either, should return null
      expect(result).toBeNull();
    });

    it("should not return user auth when token is missing tenantId", async () => {
      const mockToken = {
        id: "user-1",
        role: "ADMIN",
        name: "Admin",
        email: "admin@test.com",
      };
      vi.mocked(getToken).mockResolvedValue(mockToken as any);

      const req = createMockRequest({});
      const result = await extractAuth(req);

      expect(result).toBeNull();
    });

    it("should not return user auth when token is missing role", async () => {
      const mockToken = {
        id: "user-1",
        tenantId: TENANT.id,
        name: "Admin",
        email: "admin@test.com",
      };
      vi.mocked(getToken).mockResolvedValue(mockToken as any);

      const req = createMockRequest({});
      const result = await extractAuth(req);

      expect(result).toBeNull();
    });

    it("should not return user auth when token is null", async () => {
      vi.mocked(getToken).mockResolvedValue(null);

      const req = createMockRequest({});
      const result = await extractAuth(req);

      expect(result).toBeNull();
    });
  });

  describe("API key lookup", () => {
    it("should return apikey auth context when API key is found in database", async () => {
      vi.mocked(getToken).mockResolvedValue(null);

      const rawKey = "qs_live_test_key_123";
      const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex");

      const mockApiKey = {
        id: "apikey-001",
        tenantId: TENANT.id,
        key: hashedKey,
        permissions: ["submissions:read", "submissions:write"],
        isActive: true,
        lastUsedAt: null,
      };

      vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(mockApiKey as any);
      vi.mocked(prisma.apiKey.update).mockResolvedValue(mockApiKey as any);

      const req = createMockRequest({
        headers: { "x-api-key": rawKey },
      });
      const result = await extractAuth(req);

      expect(result).toEqual({
        type: "apikey",
        apiKey: {
          tenantId: TENANT.id,
          apiKeyId: "apikey-001",
          permissions: ["submissions:read", "submissions:write"],
        },
      });

      // Verify the key was looked up with the hashed value
      expect(prisma.apiKey.findUnique).toHaveBeenCalledWith({
        where: { key: hashedKey, isActive: true },
      });
    });

    it("should fire-and-forget update lastUsedAt when API key is found", async () => {
      vi.mocked(getToken).mockResolvedValue(null);

      const rawKey = "qs_live_update_test";
      const mockApiKey = {
        id: "apikey-002",
        tenantId: TENANT.id,
        key: hashApiKey(rawKey),
        permissions: ["submissions:read"],
        isActive: true,
        lastUsedAt: null,
      };

      vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(mockApiKey as any);
      vi.mocked(prisma.apiKey.update).mockResolvedValue(mockApiKey as any);

      const req = createMockRequest({
        headers: { "x-api-key": rawKey },
      });
      await extractAuth(req);

      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: "apikey-002" },
        data: { lastUsedAt: expect.any(Date) },
      });
    });

    it("should return null when API key is not found in database", async () => {
      vi.mocked(getToken).mockResolvedValue(null);
      vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(null);

      const req = createMockRequest({
        headers: { "x-api-key": "qs_invalid_key" },
      });
      const result = await extractAuth(req);

      expect(result).toBeNull();
    });

    it("should silently handle lastUsedAt update failure", async () => {
      vi.mocked(getToken).mockResolvedValue(null);

      const rawKey = "qs_live_error_test";
      const mockApiKey = {
        id: "apikey-003",
        tenantId: TENANT.id,
        key: hashApiKey(rawKey),
        permissions: [],
        isActive: true,
        lastUsedAt: null,
      };

      vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(mockApiKey as any);
      vi.mocked(prisma.apiKey.update).mockRejectedValue(
        new Error("DB connection lost")
      );

      const req = createMockRequest({
        headers: { "x-api-key": rawKey },
      });

      // Should not throw even though update fails
      const result = await extractAuth(req);
      expect(result).toEqual({
        type: "apikey",
        apiKey: {
          tenantId: TENANT.id,
          apiKeyId: "apikey-003",
          permissions: [],
        },
      });
    });
  });

  describe("both missing (no JWT, no API key)", () => {
    it("should return null when no JWT and no x-api-key header", async () => {
      vi.mocked(getToken).mockResolvedValue(null);

      const req = createMockRequest({});
      const result = await extractAuth(req);

      expect(result).toBeNull();
    });

    it("should return null when JWT is invalid and no x-api-key header", async () => {
      vi.mocked(getToken).mockResolvedValue({
        id: undefined,
        tenantId: undefined,
        role: undefined,
      } as any);

      const req = createMockRequest({});
      const result = await extractAuth(req);

      expect(result).toBeNull();
    });

    it("should return null when JWT is invalid and API key not found", async () => {
      vi.mocked(getToken).mockResolvedValue({ sub: "incomplete" } as any);
      vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(null);

      const req = createMockRequest({
        headers: { "x-api-key": "qs_nonexistent" },
      });
      const result = await extractAuth(req);

      expect(result).toBeNull();
    });
  });

  describe("priority: JWT takes precedence over API key", () => {
    it("should use JWT when both JWT and valid API key are present", async () => {
      const mockToken = {
        id: USERS.seniorUnderwriter.id,
        tenantId: TENANT.id,
        role: USERS.seniorUnderwriter.role,
        name: USERS.seniorUnderwriter.name,
        email: USERS.seniorUnderwriter.email,
      };
      vi.mocked(getToken).mockResolvedValue(mockToken as any);

      const req = createMockRequest({
        headers: { "x-api-key": "qs_live_valid_key" },
      });
      const result = await extractAuth(req);

      expect(result!.type).toBe("user");
      if (result!.type === "user") {
        expect(result!.user.id).toBe(USERS.seniorUnderwriter.id);
      }
      // API key lookup should never be called
      expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
    });
  });
});

// ─── unauthorizedResponse() ──────────────────────────────

describe("unauthorizedResponse", () => {
  it("should return a response with status 401", async () => {
    const response = unauthorizedResponse();
    expect(response.status).toBe(401);
  });

  it("should return JSON body with default error message", async () => {
    const response = unauthorizedResponse();
    const body = await response.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("should return JSON body with custom error message", async () => {
    const response = unauthorizedResponse("Token expired");
    const body = await response.json();
    expect(body).toEqual({ error: "Token expired" });
  });

  it("should have application/json content type", () => {
    const response = unauthorizedResponse();
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

// ─── forbiddenResponse() ─────────────────────────────────

describe("forbiddenResponse", () => {
  it("should return a response with status 403", async () => {
    const response = forbiddenResponse();
    expect(response.status).toBe(403);
  });

  it("should return JSON body with default error message", async () => {
    const response = forbiddenResponse();
    const body = await response.json();
    expect(body).toEqual({ error: "Forbidden" });
  });

  it("should return JSON body with custom error message", async () => {
    const response = forbiddenResponse("Access denied. Required role: ADMIN");
    const body = await response.json();
    expect(body).toEqual({ error: "Access denied. Required role: ADMIN" });
  });

  it("should return JSON body with broker-specific message", async () => {
    const response = forbiddenResponse(
      "Broker role can only access submission portal endpoints"
    );
    const body = await response.json();
    expect(body).toEqual({
      error: "Broker role can only access submission portal endpoints",
    });
  });

  it("should have application/json content type", () => {
    const response = forbiddenResponse();
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
