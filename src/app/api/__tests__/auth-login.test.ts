import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockCompare = vi.fn();
const mockSign = vi.fn();

vi.mock("bcryptjs", () => ({
  default: { compare: (...args: unknown[]) => mockCompare(...args) },
  compare: (...args: unknown[]) => mockCompare(...args),
}));

vi.mock("jsonwebtoken", () => ({
  default: { sign: (...args: unknown[]) => mockSign(...args) },
  sign: (...args: unknown[]) => mockSign(...args),
}));

import { POST } from "@/app/api/auth/login/route";
import { prisma } from "@/lib/prisma";
import { USERS } from "@/test/fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_SECRET = "test-secret";
  });

  // ── Validation ──────────────────────────────────────────

  it("returns 400 when email is missing", async () => {
    const res = await POST(makeRequest({ password: "pass123" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/email/i);
  });

  it("returns 400 when password is missing", async () => {
    const res = await POST(makeRequest({ email: "user@test.com" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/password/i);
  });

  it("returns 400 when both email and password are missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  // ── Authentication ─────────────────────────────────────

  it("returns 401 when user is not found", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

    const res = await POST(
      makeRequest({ email: "nobody@test.com", password: "pass" }),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/invalid/i);
  });

  it("returns 401 when password is incorrect", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(USERS.admin as never);
    mockCompare.mockResolvedValue(false);

    const res = await POST(
      makeRequest({ email: USERS.admin.email, password: "wrong" }),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/invalid/i);
  });

  it("queries for active users only", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

    await POST(
      makeRequest({ email: "user@test.com", password: "pass" }),
    );

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: "user@test.com", isActive: true },
    });
  });

  // ── Success ────────────────────────────────────────────

  it("returns a JWT token on successful login", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(USERS.admin as never);
    mockCompare.mockResolvedValue(true);
    mockSign.mockReturnValue("mock-jwt-token");

    const res = await POST(
      makeRequest({ email: USERS.admin.email, password: "correct" }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.token).toBe("mock-jwt-token");
    expect(json.user).toEqual({
      id: USERS.admin.id,
      tenantId: USERS.admin.tenantId,
      role: USERS.admin.role,
      name: USERS.admin.name,
      email: USERS.admin.email,
    });
  });

  it("signs the JWT with correct payload and expiry", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(USERS.admin as never);
    mockCompare.mockResolvedValue(true);
    mockSign.mockReturnValue("token");

    await POST(
      makeRequest({ email: USERS.admin.email, password: "correct" }),
    );

    expect(mockSign).toHaveBeenCalledWith(
      {
        sub: USERS.admin.id,
        tenantId: USERS.admin.tenantId,
        role: USERS.admin.role,
        email: USERS.admin.email,
        name: USERS.admin.name,
      },
      "test-secret",
      { expiresIn: "8h" },
    );
  });

  // ── Server Error ───────────────────────────────────────

  it("returns 500 when NEXTAUTH_SECRET is not configured", async () => {
    delete process.env.NEXTAUTH_SECRET;
    vi.mocked(prisma.user.findFirst).mockResolvedValue(USERS.admin as never);
    mockCompare.mockResolvedValue(true);

    const res = await POST(
      makeRequest({ email: USERS.admin.email, password: "correct" }),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/configuration/i);
  });
});
