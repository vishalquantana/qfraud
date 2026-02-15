import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mock auth-middleware (extractAuth) before importing route
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

vi.mock("@/lib/s3", () => ({
  uploadToS3: vi.fn().mockResolvedValue("s3://bucket/key"),
}));

vi.mock("@/lib/api-handler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-handler")>();
  return actual;
});

import { GET } from "@/app/api/submissions/route";
import { prisma } from "@/lib/prisma";
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

function makeGetRequest(queryParams: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost/api/submissions");
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url, { method: "GET" });
}

const mockSubmissions = [
  { ...SUBMISSION.clean, documents: [], submitter: USERS.broker, assignedUnderwriter: null },
  { ...SUBMISSION.reviewed, documents: [], submitter: USERS.broker, assignedUnderwriter: USERS.underwriter },
];

describe("GET /api/submissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Auth ──────────────────────────────────────────────

  it("returns 401 when not authenticated", async () => {
    mockExtractAuth.mockResolvedValue(null);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  // ── Pagination ────────────────────────────────────────

  it("returns paginated submissions with defaults (page=1, limit=20)", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findMany).mockResolvedValue(mockSubmissions as never);
    vi.mocked(prisma.submission.count).mockResolvedValue(2);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
    });
  });

  it("respects page and limit query params", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findMany).mockResolvedValue([]);
    vi.mocked(prisma.submission.count).mockResolvedValue(50);

    await GET(makeGetRequest({ page: "3", limit: "10" }));

    expect(prisma.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });

  it("caps limit at 100", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findMany).mockResolvedValue([]);
    vi.mocked(prisma.submission.count).mockResolvedValue(0);

    await GET(makeGetRequest({ limit: "500" }));

    expect(prisma.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it("enforces minimum page of 1", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findMany).mockResolvedValue([]);
    vi.mocked(prisma.submission.count).mockResolvedValue(0);

    await GET(makeGetRequest({ page: "-5" }));

    expect(prisma.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 }),
    );
  });

  // ── Filters ───────────────────────────────────────────

  it("filters by status when provided", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findMany).mockResolvedValue([]);
    vi.mocked(prisma.submission.count).mockResolvedValue(0);

    await GET(makeGetRequest({ status: "UNDER_REVIEW" }));

    expect(prisma.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "UNDER_REVIEW" }),
      }),
    );
  });

  it("filters by severity when provided", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findMany).mockResolvedValue([]);
    vi.mocked(prisma.submission.count).mockResolvedValue(0);

    await GET(makeGetRequest({ severity: "CRITICAL" }));

    expect(prisma.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ severity: "CRITICAL" }),
      }),
    );
  });

  it("filters by date range", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findMany).mockResolvedValue([]);
    vi.mocked(prisma.submission.count).mockResolvedValue(0);

    await GET(makeGetRequest({ dateFrom: "2025-01-01", dateTo: "2025-12-31" }));

    expect(prisma.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date("2025-01-01"),
            lte: new Date("2025-12-31"),
          },
        }),
      }),
    );
  });

  // ── Tenant Scoping ────────────────────────────────────

  it("scopes all queries to the authenticated tenant", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findMany).mockResolvedValue([]);
    vi.mocked(prisma.submission.count).mockResolvedValue(0);

    await GET(makeGetRequest());

    expect(prisma.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT.id }),
      }),
    );
    expect(prisma.submission.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT.id }),
      }),
    );
  });

  // ── Broker Restrictions ───────────────────────────────

  it("restricts brokers to only their own submissions", async () => {
    authAsUser(USERS.broker);
    vi.mocked(prisma.submission.findMany).mockResolvedValue([]);
    vi.mocked(prisma.submission.count).mockResolvedValue(0);

    await GET(makeGetRequest());

    expect(prisma.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ submitterId: USERS.broker.id }),
      }),
    );
  });

  it("does not restrict underwriters to own submissions", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findMany).mockResolvedValue([]);
    vi.mocked(prisma.submission.count).mockResolvedValue(0);

    await GET(makeGetRequest());

    const callArg = vi.mocked(prisma.submission.findMany).mock.calls[0][0] as Record<string, unknown>;
    const where = callArg.where as Record<string, unknown>;
    expect(where).not.toHaveProperty("submitterId");
  });

  // ── Ordering ──────────────────────────────────────────

  it("orders submissions by createdAt descending", async () => {
    authAsUser(USERS.underwriter);
    vi.mocked(prisma.submission.findMany).mockResolvedValue([]);
    vi.mocked(prisma.submission.count).mockResolvedValue(0);

    await GET(makeGetRequest());

    expect(prisma.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } }),
    );
  });
});
