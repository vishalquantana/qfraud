import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockExtractAuth = vi.fn();

vi.mock("@/lib/auth-middleware", () => ({
  extractAuth: (...args: unknown[]) => mockExtractAuth(...args),
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

import { GET, PUT } from "@/app/api/config/thresholds/route";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/services/audit-log";
import { USERS, TENANT, THRESHOLD_CONFIG } from "@/test/fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function authAsUser(user: (typeof USERS)[keyof typeof USERS]) {
  mockExtractAuth.mockResolvedValue({
    type: "user" as const,
    user: {
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
      name: user.name,
      email: user.email,
    },
  });
}

function makeGetReq(): NextRequest {
  return new NextRequest("http://localhost/api/config/thresholds", { method: "GET" });
}

function makePutReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/config/thresholds", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/config/thresholds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsUser(USERS.admin);
  });

  it("returns 401 when not authenticated", async () => {
    mockExtractAuth.mockResolvedValue(null);
    const res = await GET(makeGetReq());
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-ADMIN roles", async () => {
    authAsUser(USERS.underwriter);
    const res = await GET(makeGetReq());
    expect(res.status).toBe(403);
  });

  it("returns default thresholds when no config exists", async () => {
    vi.mocked(prisma.thresholdConfig.findMany).mockResolvedValue([]);

    const res = await GET(makeGetReq());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.global.autoApproveBelow).toBe(20);
    expect(json.data.global.autoEscalateAbove).toBe(70);
    expect(json.data.global.siuReferralOnCritical).toBe(true);
    expect(json.data.overrides).toEqual([]);
  });

  it("returns saved global config and per-LOB overrides", async () => {
    vi.mocked(prisma.thresholdConfig.findMany).mockResolvedValue([
      { ...THRESHOLD_CONFIG.default, lineOfBusiness: null } as never,
      {
        ...THRESHOLD_CONFIG.default,
        id: "threshold-002",
        lineOfBusiness: "Workers Compensation",
        autoApproveBelow: 15,
        autoEscalateAbove: 80,
      } as never,
    ]);

    const json = await (await GET(makeGetReq())).json();
    expect(json.data.global.autoApproveBelow).toBe(20);
    expect(json.data.overrides).toHaveLength(1);
    expect(json.data.overrides[0].lineOfBusiness).toBe("Workers Compensation");
  });
});

describe("PUT /api/config/thresholds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsUser(USERS.admin);
    vi.mocked(prisma.thresholdConfig.findFirst).mockResolvedValue(
      THRESHOLD_CONFIG.default as never,
    );
    vi.mocked(prisma.thresholdConfig.update).mockResolvedValue({
      ...THRESHOLD_CONFIG.default,
      autoApproveBelow: 15,
    } as never);
  });

  it("returns 401 when not authenticated", async () => {
    mockExtractAuth.mockResolvedValue(null);
    const res = await PUT(makePutReq({ autoApproveBelow: 15 }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-ADMIN roles", async () => {
    authAsUser(USERS.underwriter);
    const res = await PUT(makePutReq({ autoApproveBelow: 15 }));
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/config/thresholds", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when autoApproveBelow is out of range", async () => {
    const res = await PUT(makePutReq({ autoApproveBelow: -5 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when autoApproveBelow exceeds 100", async () => {
    const res = await PUT(makePutReq({ autoApproveBelow: 150 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when autoEscalateAbove is out of range", async () => {
    const res = await PUT(makePutReq({ autoEscalateAbove: -1 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when autoApproveBelow >= autoEscalateAbove", async () => {
    const res = await PUT(
      makePutReq({ autoApproveBelow: 80, autoEscalateAbove: 70 }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/less than/i);
  });

  it("returns 400 when siuReferralOnCritical is not boolean", async () => {
    const res = await PUT(makePutReq({ siuReferralOnCritical: "yes" }));
    expect(res.status).toBe(400);
  });

  it("updates existing global config", async () => {
    await PUT(makePutReq({ autoApproveBelow: 15 }));

    expect(prisma.thresholdConfig.update).toHaveBeenCalledWith({
      where: { id: THRESHOLD_CONFIG.default.id },
      data: { autoApproveBelow: 15 },
    });
  });

  it("creates global config when none exists", async () => {
    vi.mocked(prisma.thresholdConfig.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.thresholdConfig.create).mockResolvedValue({
      ...THRESHOLD_CONFIG.default,
      autoApproveBelow: 10,
    } as never);

    await PUT(makePutReq({ autoApproveBelow: 10 }));

    expect(prisma.thresholdConfig.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT.id,
        lineOfBusiness: null,
        autoApproveBelow: 10,
      }),
    });
  });

  it("creates audit log on threshold change", async () => {
    await PUT(makePutReq({ autoApproveBelow: 15 }));

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT.id,
        action: "THRESHOLD_CHANGED",
        details: expect.objectContaining({
          scope: "global",
          before: expect.objectContaining({ autoApproveBelow: 20 }),
        }),
      }),
    );
  });
});
