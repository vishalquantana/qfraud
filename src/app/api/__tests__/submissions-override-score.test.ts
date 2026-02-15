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

import { PATCH } from "@/app/api/submissions/[id]/override-score/route";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/services/audit-log";
import { USERS, TENANT, SUBMISSION } from "@/test/fixtures";

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

function makePatchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/submissions/sub-reviewed/override-score", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const routeContext = { params: Promise.resolve({ id: "sub-reviewed" }) };

describe("PATCH /api/submissions/:id/override-score", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsUser(USERS.seniorUnderwriter);
    vi.mocked(prisma.submission.findFirst).mockResolvedValue(SUBMISSION.reviewed as never);
    vi.mocked(prisma.submission.update).mockResolvedValue({
      ...SUBMISSION.reviewed,
      riskScore: 30,
      severity: "LOW",
    } as never);
  });

  // ── Auth & Authorization ──────────────────────────────

  it("returns 401 when not authenticated", async () => {
    mockExtractAuth.mockResolvedValue(null);

    const res = await PATCH(
      makePatchRequest({ score: 30, justification: "reason" }),
      routeContext,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for regular UNDERWRITER (not senior)", async () => {
    authAsUser(USERS.underwriter);

    const res = await PATCH(
      makePatchRequest({ score: 30, justification: "reason" }),
      routeContext,
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 for BROKER", async () => {
    authAsUser(USERS.broker);

    const res = await PATCH(
      makePatchRequest({ score: 30, justification: "reason" }),
      routeContext,
    );
    expect(res.status).toBe(403);
  });

  it("allows ADMIN to override score", async () => {
    authAsUser(USERS.admin);

    const res = await PATCH(
      makePatchRequest({ score: 30, justification: "Admin override" }),
      routeContext,
    );
    expect(res.status).toBe(200);
  });

  it("allows SENIOR_UNDERWRITER to override score", async () => {
    authAsUser(USERS.seniorUnderwriter);

    const res = await PATCH(
      makePatchRequest({ score: 30, justification: "Senior override" }),
      routeContext,
    );
    expect(res.status).toBe(200);
  });

  // ── Validation ────────────────────────────────────────

  it("returns 400 for invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/submissions/sub-reviewed/override-score", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });

    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(400);
  });

  it("returns 400 when score is missing", async () => {
    const res = await PATCH(
      makePatchRequest({ justification: "reason" }),
      routeContext,
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/score/i);
  });

  it("returns 400 when score is below 0", async () => {
    const res = await PATCH(
      makePatchRequest({ score: -5, justification: "reason" }),
      routeContext,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when score is above 100", async () => {
    const res = await PATCH(
      makePatchRequest({ score: 150, justification: "reason" }),
      routeContext,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when justification is missing", async () => {
    const res = await PATCH(
      makePatchRequest({ score: 50 }),
      routeContext,
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/justification/i);
  });

  it("returns 400 when justification is empty", async () => {
    const res = await PATCH(
      makePatchRequest({ score: 50, justification: "   " }),
      routeContext,
    );
    expect(res.status).toBe(400);
  });

  // ── Not Found ─────────────────────────────────────────

  it("returns 404 when submission does not exist", async () => {
    vi.mocked(prisma.submission.findFirst).mockResolvedValue(null);

    const res = await PATCH(
      makePatchRequest({ score: 30, justification: "reason" }),
      routeContext,
    );
    expect(res.status).toBe(404);
  });

  // ── Severity Calculation ──────────────────────────────

  it.each([
    { score: 0, expectedSeverity: "CLEAN" },
    { score: 10, expectedSeverity: "LOW" },
    { score: 34, expectedSeverity: "LOW" },
    { score: 35, expectedSeverity: "MEDIUM" },
    { score: 59, expectedSeverity: "MEDIUM" },
    { score: 60, expectedSeverity: "HIGH" },
    { score: 84, expectedSeverity: "HIGH" },
    { score: 85, expectedSeverity: "CRITICAL" },
    { score: 100, expectedSeverity: "CRITICAL" },
  ])("maps score $score to severity $expectedSeverity", async ({ score, expectedSeverity }) => {
    vi.mocked(prisma.submission.update).mockResolvedValue({
      ...SUBMISSION.reviewed,
      riskScore: score,
      severity: expectedSeverity,
    } as never);

    await PATCH(
      makePatchRequest({ score, justification: "override test" }),
      routeContext,
    );

    expect(prisma.submission.update).toHaveBeenCalledWith({
      where: { id: "sub-reviewed" },
      data: { riskScore: score, severity: expectedSeverity },
    });
  });

  // ── Audit Log ─────────────────────────────────────────

  it("creates an audit log for score override", async () => {
    await PATCH(
      makePatchRequest({ score: 30, justification: "Risk reassessment" }),
      routeContext,
    );

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT.id,
        action: "SCORE_OVERRIDE",
        submissionId: "sub-reviewed",
        details: expect.objectContaining({
          previousScore: 45,
          newScore: 30,
          justification: "Risk reassessment",
        }),
      }),
    );
  });

  // ── Response ──────────────────────────────────────────

  it("returns the updated score and previous score", async () => {
    vi.mocked(prisma.submission.update).mockResolvedValue({
      ...SUBMISSION.reviewed,
      id: "sub-reviewed",
      riskScore: 30,
      severity: "LOW",
    } as never);

    const res = await PATCH(
      makePatchRequest({ score: 30, justification: "reason" }),
      routeContext,
    );

    const json = await res.json();
    expect(json.data.riskScore).toBe(30);
    expect(json.data.severity).toBe("LOW");
    expect(json.data.previousScore).toBe(45);
  });
});
