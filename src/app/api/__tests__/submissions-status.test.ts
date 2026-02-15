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

vi.mock("@/services/notification", () => ({
  sendNotification: vi.fn().mockResolvedValue(undefined),
}));

import { PATCH } from "@/app/api/submissions/[id]/status/route";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/services/audit-log";
import { sendNotification } from "@/services/notification";
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
  return new NextRequest("http://localhost/api/submissions/sub-reviewed/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const routeContext = { params: Promise.resolve({ id: "sub-reviewed" }) };

const mockSubmission = {
  ...SUBMISSION.reviewed,
  submitter: { email: USERS.broker.email, name: USERS.broker.name },
};

describe("PATCH /api/submissions/:id/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findFirst).mockResolvedValue(mockSubmission as never);
    vi.mocked(prisma.submission.update).mockResolvedValue({
      ...SUBMISSION.reviewed,
      status: "APPROVED",
    } as never);
  });

  // ── Auth & Authorization ──────────────────────────────

  it("returns 401 when not authenticated", async () => {
    mockExtractAuth.mockResolvedValue(null);

    const res = await PATCH(makePatchRequest({ action: "approve" }), routeContext);
    expect(res.status).toBe(401);
  });

  it("returns 403 when broker attempts status change", async () => {
    authAsUser(USERS.broker);

    const res = await PATCH(makePatchRequest({ action: "approve" }), routeContext);
    expect(res.status).toBe(403);
  });

  it("allows ADMIN to change status", async () => {
    authAsUser(USERS.admin);

    const res = await PATCH(makePatchRequest({ action: "approve" }), routeContext);
    expect(res.status).toBe(200);
  });

  it("allows SENIOR_UNDERWRITER to change status", async () => {
    authAsUser(USERS.seniorUnderwriter);

    const res = await PATCH(makePatchRequest({ action: "approve" }), routeContext);
    expect(res.status).toBe(200);
  });

  it("allows UNDERWRITER to change status", async () => {
    authAsUser(USERS.underwriter);

    const res = await PATCH(makePatchRequest({ action: "approve" }), routeContext);
    expect(res.status).toBe(200);
  });

  it("allows SIU_INVESTIGATOR to change status", async () => {
    authAsUser(USERS.siuInvestigator);

    const res = await PATCH(makePatchRequest({ action: "approve" }), routeContext);
    expect(res.status).toBe(200);
  });

  // ── Validation ────────────────────────────────────────

  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/submissions/sub-reviewed/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });

    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid json/i);
  });

  it("returns 400 when action is missing", async () => {
    const res = await PATCH(makePatchRequest({}), routeContext);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid action/i);
  });

  it("returns 400 for unknown action", async () => {
    const res = await PATCH(makePatchRequest({ action: "nuke" }), routeContext);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid action/i);
  });

  it("returns 400 when decline is missing justification", async () => {
    const res = await PATCH(
      makePatchRequest({ action: "decline" }),
      routeContext,
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/justification/i);
  });

  it("returns 400 when decline justification is only whitespace", async () => {
    const res = await PATCH(
      makePatchRequest({ action: "decline", justification: "   " }),
      routeContext,
    );
    expect(res.status).toBe(400);
  });

  // ── Submission Not Found ──────────────────────────────

  it("returns 404 when submission does not exist", async () => {
    vi.mocked(prisma.submission.findFirst).mockResolvedValue(null);

    const res = await PATCH(makePatchRequest({ action: "approve" }), routeContext);
    expect(res.status).toBe(404);
  });

  // ── Approve ───────────────────────────────────────────

  it("approves a submission successfully", async () => {
    const res = await PATCH(makePatchRequest({ action: "approve" }), routeContext);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.status).toBe("APPROVED");
    expect(json.data.previousStatus).toBe("UNDER_REVIEW");

    expect(prisma.submission.update).toHaveBeenCalledWith({
      where: { id: "sub-reviewed" },
      data: { status: "APPROVED" },
    });
  });

  it("does NOT require justification for approval", async () => {
    const res = await PATCH(makePatchRequest({ action: "approve" }), routeContext);
    expect(res.status).toBe(200);
  });

  // ── Decline ───────────────────────────────────────────

  it("declines a submission with justification", async () => {
    vi.mocked(prisma.submission.update).mockResolvedValue({
      ...SUBMISSION.reviewed,
      status: "DECLINED",
    } as never);

    const res = await PATCH(
      makePatchRequest({ action: "decline", justification: "Suspicious revenue" }),
      routeContext,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe("DECLINED");
  });

  // ── Refer to SIU ──────────────────────────────────────

  it("creates an SIU case when referring to SIU", async () => {
    vi.mocked(prisma.submission.update).mockResolvedValue({
      ...SUBMISSION.reviewed,
      status: "REFERRED_TO_SIU",
    } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(USERS.siuInvestigator as never);
    vi.mocked(prisma.sIUCase.create).mockResolvedValue({} as never);

    const res = await PATCH(
      makePatchRequest({ action: "refer-to-siu" }),
      routeContext,
    );
    expect(res.status).toBe(200);

    expect(prisma.sIUCase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT.id,
        submissionId: "sub-reviewed",
        status: "OPEN",
        assignedToId: USERS.siuInvestigator.id,
      }),
    });
  });

  // ── Audit Logging ─────────────────────────────────────

  it("creates an audit log entry on status change", async () => {
    await PATCH(makePatchRequest({ action: "approve" }), routeContext);

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT.id,
        action: "SUBMISSION_APPROVED",
        submissionId: "sub-reviewed",
        details: expect.objectContaining({
          previousStatus: "UNDER_REVIEW",
          newStatus: "APPROVED",
        }),
      }),
    );
  });

  it("records SUBMISSION_DECLINED audit action on decline", async () => {
    vi.mocked(prisma.submission.update).mockResolvedValue({
      ...SUBMISSION.reviewed,
      status: "DECLINED",
    } as never);

    await PATCH(
      makePatchRequest({ action: "decline", justification: "Fraud detected" }),
      routeContext,
    );

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SUBMISSION_DECLINED" }),
    );
  });

  // ── Notifications ─────────────────────────────────────

  it("sends notification on approval", async () => {
    await PATCH(makePatchRequest({ action: "approve" }), routeContext);

    expect(sendNotification).toHaveBeenCalledWith(
      "SUBMISSION_APPROVED",
      USERS.broker.email,
      TENANT.id,
      expect.objectContaining({ submissionId: "sub-reviewed" }),
    );
  });

  it("sends notification on decline", async () => {
    vi.mocked(prisma.submission.update).mockResolvedValue({
      ...SUBMISSION.reviewed,
      status: "DECLINED",
    } as never);

    await PATCH(
      makePatchRequest({ action: "decline", justification: "Fraud" }),
      routeContext,
    );

    expect(sendNotification).toHaveBeenCalledWith(
      "SUBMISSION_DECLINED",
      USERS.broker.email,
      TENANT.id,
      expect.objectContaining({ submissionId: "sub-reviewed" }),
    );
  });

  it("does not fail if notification throws", async () => {
    vi.mocked(sendNotification).mockRejectedValue(new Error("SMTP down"));

    const res = await PATCH(makePatchRequest({ action: "approve" }), routeContext);
    // Should still succeed — notification is fire-and-forget
    expect(res.status).toBe(200);
  });

  // ── Tenant scoping ────────────────────────────────────

  it("scopes submission lookup to authenticated tenant", async () => {
    await PATCH(makePatchRequest({ action: "approve" }), routeContext);

    expect(prisma.submission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT.id }),
      }),
    );
  });
});
