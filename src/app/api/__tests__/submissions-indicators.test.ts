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

import { GET } from "@/app/api/submissions/[id]/indicators/route";
import { prisma } from "@/lib/prisma";
import { USERS, TENANT, SUBMISSION, FRAUD_INDICATORS } from "@/test/fixtures";

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

function makeGetReq(
  id: string,
  params: Record<string, string> = {},
): NextRequest {
  const url = new URL(`http://localhost/api/submissions/${id}/indicators`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url, { method: "GET" });
}

const routeContext = (id: string) => ({
  params: Promise.resolve({ id }),
});

const mockIndicators = [
  {
    ...FRAUD_INDICATORS.revenueMismatch,
    document: null,
    overriddenBy: null,
  },
  {
    ...FRAUD_INDICATORS.lossHistoryOmission,
    document: null,
    overriddenBy: null,
  },
  {
    ...FRAUD_INDICATORS.roundNumbers,
    document: null,
    overriddenBy: null,
  },
];

describe("GET /api/submissions/:id/indicators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findFirst).mockResolvedValue(
      { id: SUBMISSION.fraudulent.id } as never,
    );
    vi.mocked(prisma.fraudIndicator.findMany).mockResolvedValue(
      mockIndicators as never,
    );
  });

  // ── Auth ──────────────────────────────────────────────

  it("returns 401 when not authenticated", async () => {
    mockExtractAuth.mockResolvedValue(null);

    const res = await GET(
      makeGetReq("sub-fraud"),
      routeContext("sub-fraud"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for BROKER role", async () => {
    authAsUser(USERS.broker);

    const res = await GET(
      makeGetReq("sub-fraud"),
      routeContext("sub-fraud"),
    );
    expect(res.status).toBe(403);
  });

  it("allows ADMIN to view indicators", async () => {
    authAsUser(USERS.admin);
    const res = await GET(makeGetReq("sub-fraud"), routeContext("sub-fraud"));
    expect(res.status).toBe(200);
  });

  it("allows COMPLIANCE_OFFICER to view indicators", async () => {
    authAsUser(USERS.complianceOfficer);
    const res = await GET(makeGetReq("sub-fraud"), routeContext("sub-fraud"));
    expect(res.status).toBe(200);
  });

  it("allows SIU_INVESTIGATOR to view indicators", async () => {
    authAsUser(USERS.siuInvestigator);
    const res = await GET(makeGetReq("sub-fraud"), routeContext("sub-fraud"));
    expect(res.status).toBe(200);
  });

  // ── Success ───────────────────────────────────────────

  it("returns all indicators for the submission", async () => {
    const res = await GET(makeGetReq("sub-fraud"), routeContext("sub-fraud"));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toHaveLength(3);
  });

  // ── Not Found ─────────────────────────────────────────

  it("returns 404 when submission does not exist", async () => {
    vi.mocked(prisma.submission.findFirst).mockResolvedValue(null);

    const res = await GET(makeGetReq("nonexistent"), routeContext("nonexistent"));
    expect(res.status).toBe(404);
  });

  // ── Filtering ─────────────────────────────────────────

  it("filters by category when provided", async () => {
    await GET(
      makeGetReq("sub-fraud", { category: "CROSS_DOC" }),
      routeContext("sub-fraud"),
    );

    expect(prisma.fraudIndicator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: "CROSS_DOC" }),
      }),
    );
  });

  it("filters by severity when provided", async () => {
    await GET(
      makeGetReq("sub-fraud", { severity: "CRITICAL" }),
      routeContext("sub-fraud"),
    );

    expect(prisma.fraudIndicator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ severity: "CRITICAL" }),
      }),
    );
  });

  // ── Ordering ──────────────────────────────────────────

  it("orders by severity ascending then createdAt descending", async () => {
    await GET(makeGetReq("sub-fraud"), routeContext("sub-fraud"));

    expect(prisma.fraudIndicator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      }),
    );
  });

  // ── Tenant Scoping ────────────────────────────────────

  it("scopes both submission and indicator queries to tenant", async () => {
    await GET(makeGetReq("sub-fraud"), routeContext("sub-fraud"));

    expect(prisma.submission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT.id }),
      }),
    );
    expect(prisma.fraudIndicator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT.id }),
      }),
    );
  });

  // ── Includes ──────────────────────────────────────────

  it("includes document and overriddenBy relationships", async () => {
    await GET(makeGetReq("sub-fraud"), routeContext("sub-fraud"));

    expect(prisma.fraudIndicator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          document: expect.any(Object),
          overriddenBy: expect.any(Object),
        }),
      }),
    );
  });
});
