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

import { GET } from "@/app/api/submissions/[id]/route";
import { prisma } from "@/lib/prisma";
import { USERS, TENANT, SUBMISSION, DOCUMENTS } from "@/test/fixtures";

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

function makeGetRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/submissions/${id}`, {
    method: "GET",
  });
}

const routeContext = (id: string) => ({
  params: Promise.resolve({ id }),
});

const fullSubmission = {
  ...SUBMISSION.clean,
  documents: [DOCUMENTS.acord125, DOCUMENTS.acord130],
  submitter: { id: USERS.broker.id, name: USERS.broker.name, email: USERS.broker.email },
  assignedUnderwriter: null,
  _count: { fraudIndicators: 0 },
};

describe("GET /api/submissions/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Auth ──────────────────────────────────────────────

  it("returns 401 when not authenticated", async () => {
    mockExtractAuth.mockResolvedValue(null);

    const res = await GET(makeGetRequest("sub-clean"), routeContext("sub-clean"));
    expect(res.status).toBe(401);
  });

  // ── Success ───────────────────────────────────────────

  it("returns the submission with documents and relationships", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findFirst).mockResolvedValue(fullSubmission as never);

    const res = await GET(makeGetRequest("sub-clean"), routeContext("sub-clean"));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.id).toBe("sub-clean");
    expect(json.data.documents).toHaveLength(2);
    expect(json.data.submitter.email).toBe(USERS.broker.email);
  });

  // ── Not Found ─────────────────────────────────────────

  it("returns 404 when submission does not exist", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findFirst).mockResolvedValue(null);

    const res = await GET(makeGetRequest("nonexistent"), routeContext("nonexistent"));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  // ── Tenant scoping ────────────────────────────────────

  it("scopes query to authenticated tenant", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findFirst).mockResolvedValue(fullSubmission as never);

    await GET(makeGetRequest("sub-clean"), routeContext("sub-clean"));

    expect(prisma.submission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "sub-clean",
          tenantId: TENANT.id,
        }),
      }),
    );
  });

  // ── Broker restrictions ───────────────────────────────

  it("allows broker to view their own submission", async () => {
    authAsUser(USERS.broker);
    vi.mocked(prisma.submission.findFirst).mockResolvedValue({
      ...fullSubmission,
      submitterId: USERS.broker.id,
    } as never);

    const res = await GET(makeGetRequest("sub-clean"), routeContext("sub-clean"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when broker tries to view another users submission", async () => {
    authAsUser(USERS.broker);
    vi.mocked(prisma.submission.findFirst).mockResolvedValue({
      ...fullSubmission,
      submitterId: "other-user-id",
    } as never);

    const res = await GET(makeGetRequest("sub-clean"), routeContext("sub-clean"));
    expect(res.status).toBe(404);
  });

  it("allows underwriter to view any tenants submission", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findFirst).mockResolvedValue({
      ...fullSubmission,
      submitterId: "other-user-id",
    } as never);

    const res = await GET(makeGetRequest("sub-clean"), routeContext("sub-clean"));
    expect(res.status).toBe(200);
  });

  // ── Includes ──────────────────────────────────────────

  it("includes document details, submitter, underwriter, and indicator count", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findFirst).mockResolvedValue(fullSubmission as never);

    await GET(makeGetRequest("sub-clean"), routeContext("sub-clean"));

    expect(prisma.submission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          documents: expect.any(Object),
          submitter: expect.any(Object),
          assignedUnderwriter: expect.any(Object),
          _count: { select: { fraudIndicators: true } },
        }),
      }),
    );
  });
});
