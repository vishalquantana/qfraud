import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockExtractAuth = vi.fn();

vi.mock("@/lib/auth-middleware", () => ({
  extractAuth: (...args: unknown[]) => mockExtractAuth(...args),
  hashApiKey: vi.fn().mockReturnValue("hashed-key-value"),
  unauthorizedResponse: () => {
    const { NextResponse } = require("next/server");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  },
  forbiddenResponse: (msg: string) => {
    const { NextResponse } = require("next/server");
    return NextResponse.json({ error: msg }, { status: 403 });
  },
}));

vi.mock("@/services/audit-log", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import { GET, POST } from "@/app/api/config/api-keys/route";
import { prisma } from "@/lib/prisma";
import { USERS, TENANT } from "@/test/fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function authAsAdmin() {
  mockExtractAuth.mockResolvedValue({
    type: "user" as const,
    user: {
      id: USERS.admin.id,
      tenantId: USERS.admin.tenantId,
      role: "ADMIN",
      name: USERS.admin.name,
      email: USERS.admin.email,
    },
  });
}

function makeGetReq(): NextRequest {
  return new NextRequest("http://localhost/api/config/api-keys", { method: "GET" });
}

function makePostReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/config/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const mockApiKeys = [
  {
    id: "key-1",
    name: "Production Key",
    key: "hashedkeyvalue1234567890",
    isActive: true,
    permissions: ["*"],
    createdAt: new Date("2025-01-01"),
    lastUsedAt: new Date("2025-06-01"),
  },
];

describe("GET /api/config/api-keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsAdmin();
  });

  it("returns 401 when not authenticated", async () => {
    mockExtractAuth.mockResolvedValue(null);
    const res = await GET(makeGetReq());
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-ADMIN roles", async () => {
    mockExtractAuth.mockResolvedValue({
      type: "user" as const,
      user: { ...USERS.underwriter, role: "UNDERWRITER" },
    });
    const res = await GET(makeGetReq());
    expect(res.status).toBe(403);
  });

  it("returns API keys with only key prefix (not full key)", async () => {
    vi.mocked(prisma.apiKey.findMany).mockResolvedValue(mockApiKeys as never);

    const res = await GET(makeGetReq());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].keyPrefix).toBe("hashedke");
    expect(json.data[0]).not.toHaveProperty("key");
  });

  it("scopes query to tenant", async () => {
    vi.mocked(prisma.apiKey.findMany).mockResolvedValue([]);

    await GET(makeGetReq());

    expect(prisma.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT.id }),
      }),
    );
  });
});

describe("POST /api/config/api-keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsAdmin();
    vi.mocked(prisma.apiKey.create).mockResolvedValue({
      id: "new-key-id",
      tenantId: TENANT.id,
      name: "New Key",
      key: "hashed-key-value",
      isActive: true,
      permissions: ["*"],
      createdAt: new Date(),
      lastUsedAt: null,
    } as never);
  });

  it("returns 401 when not authenticated", async () => {
    mockExtractAuth.mockResolvedValue(null);
    const res = await POST(makePostReq({ name: "Test Key" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-ADMIN roles", async () => {
    mockExtractAuth.mockResolvedValue({
      type: "user" as const,
      user: { ...USERS.broker, role: "BROKER" },
    });
    const res = await POST(makePostReq({ name: "Test Key" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(makePostReq({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/name/i);
  });

  it("returns 400 when name is empty string", async () => {
    const res = await POST(makePostReq({ name: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/config/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("creates a new API key and returns 201", async () => {
    const res = await POST(makePostReq({ name: "Production Key", permissions: ["*"] }));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.data.id).toBe("new-key-id");
    expect(json.data.key).toMatch(/^qsk_/); // Key shown only once
    expect(json.data.name).toBe("New Key");
  });

  it("generates key with qsk_ prefix", async () => {
    const res = await POST(makePostReq({ name: "New Key" }));
    const json = await res.json();
    expect(json.data.key).toMatch(/^qsk_[a-f0-9]{64}$/);
  });

  it("hashes the key before storing in database", async () => {
    await POST(makePostReq({ name: "Test" }));

    expect(prisma.apiKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: expect.not.stringMatching(/^qsk_/), // Should be hashed, not raw
      }),
    });
  });

  it("trims the key name", async () => {
    await POST(makePostReq({ name: "  Padded Name  " }));

    expect(prisma.apiKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Padded Name",
      }),
    });
  });
});
