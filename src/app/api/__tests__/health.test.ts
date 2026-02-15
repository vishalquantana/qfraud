import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@/lib/queue", () => ({
  getQueueStats: vi.fn(),
}));

import { GET } from "@/app/api/health/route";
import { prisma } from "@/lib/prisma";
import { getQueueStats } from "@/lib/queue";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_S3_BUCKET = "test-bucket";
    process.env.AWS_ACCESS_KEY_ID = "test-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_HOST = "smtp.test.com";
  });

  // ── Healthy State ────────────────────────────────────

  it("returns 200 with healthy status when all services are up", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{ "?column?": 1 }]);
    vi.mocked(getQueueStats).mockResolvedValue({
      waiting: 0,
      active: 1,
      completed: 100,
      failed: 2,
      delayed: 0,
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe("healthy");
    expect(json.services.database.status).toBe("healthy");
    expect(json.services.queue.status).toBe("healthy");
    expect(json.services.storage.status).toBe("healthy");
    expect(json.services.gemini.status).toBe("healthy");
    expect(json.services.email.status).toBe("healthy");
  });

  it("includes a timestamp in ISO format", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);
    vi.mocked(getQueueStats).mockResolvedValue({
      waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
    });

    const json = await (await GET()).json();
    expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("includes version information", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);
    vi.mocked(getQueueStats).mockResolvedValue({
      waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
    });

    const json = await (await GET()).json();
    expect(json.version).toBeDefined();
  });

  // ── Database Down ─────────────────────────────────────

  it("returns 503 when database is unhealthy", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockRejectedValue(new Error("Connection refused"));
    vi.mocked(getQueueStats).mockResolvedValue({
      waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
    });

    const res = await GET();
    expect(res.status).toBe(503);

    const json = await res.json();
    expect(json.status).toBe("unhealthy");
    expect(json.services.database.status).toBe("unhealthy");
    expect(json.services.database.error).toMatch(/Connection refused/);
  });

  it("includes latency measurement for database", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);
    vi.mocked(getQueueStats).mockResolvedValue({
      waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
    });

    const json = await (await GET()).json();
    expect(typeof json.services.database.latencyMs).toBe("number");
  });

  // ── Queue Degraded ────────────────────────────────────

  it("marks queue as degraded (not unhealthy) when Redis is unavailable", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);
    vi.mocked(getQueueStats).mockRejectedValue(new Error("Redis unavailable"));

    const res = await GET();
    // Queue being down doesn't make the whole service unhealthy
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.services.queue.status).toBe("degraded");
    expect(json.services.queue.error).toMatch(/Redis/i);
  });

  // ── Storage Not Configured ────────────────────────────

  it("marks storage as degraded when S3 env vars are missing", async () => {
    delete process.env.AWS_S3_BUCKET;
    delete process.env.AWS_ACCESS_KEY_ID;
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);
    vi.mocked(getQueueStats).mockResolvedValue({
      waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
    });

    const json = await (await GET()).json();
    expect(json.services.storage.status).toBe("degraded");
  });

  // ── Gemini Not Configured ─────────────────────────────

  it("marks gemini as degraded when API key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);
    vi.mocked(getQueueStats).mockResolvedValue({
      waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
    });

    const json = await (await GET()).json();
    expect(json.services.gemini.status).toBe("degraded");
  });

  // ── Email Not Configured ──────────────────────────────

  it("marks email as degraded when no SMTP config exists", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SENDGRID_API_KEY;
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);
    vi.mocked(getQueueStats).mockResolvedValue({
      waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
    });

    const json = await (await GET()).json();
    expect(json.services.email.status).toBe("degraded");
  });

  it("checks SendGrid API key when provider is sendgrid", async () => {
    process.env.EMAIL_PROVIDER = "sendgrid";
    process.env.SENDGRID_API_KEY = "SG.test";
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);
    vi.mocked(getQueueStats).mockResolvedValue({
      waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
    });

    const json = await (await GET()).json();
    expect(json.services.email.status).toBe("healthy");
    expect(json.services.email.details).toEqual(
      expect.objectContaining({ provider: "sendgrid", configured: true }),
    );
  });
});
