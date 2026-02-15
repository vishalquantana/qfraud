import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------
const mockIncr = vi.fn();
const mockExpire = vi.fn();
const mockTtl = vi.fn();

vi.mock("@/lib/redis", () => ({
  getRedisClient: vi.fn(() => ({
    incr: mockIncr,
    expire: mockExpire,
    ttl: mockTtl,
  })),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { checkRateLimit, createRateLimiter } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows requests under the limit", async () => {
    mockIncr.mockResolvedValue(1);
    mockTtl.mockResolvedValue(60);

    const result = await checkRateLimit("api:tenant-1", 100, 60);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it("sets expiry on the first request (TTL = -1 means no expiry set yet)", async () => {
    mockIncr.mockResolvedValue(1);
    mockTtl.mockResolvedValue(-1);

    await checkRateLimit("api:tenant-1", 100, 60);

    expect(mockExpire).toHaveBeenCalledWith("rl:api:tenant-1", 60);
  });

  it("does NOT reset expiry on subsequent requests", async () => {
    mockIncr.mockResolvedValue(5);
    mockTtl.mockResolvedValue(45);

    await checkRateLimit("api:tenant-1", 100, 60);

    expect(mockExpire).not.toHaveBeenCalled();
  });

  it("denies requests that exceed the limit", async () => {
    mockIncr.mockResolvedValue(101);
    mockTtl.mockResolvedValue(30);

    const result = await checkRateLimit("api:tenant-1", 100, 60);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBe(30);
  });

  it("returns remaining = 0 when count equals limit", async () => {
    mockIncr.mockResolvedValue(100);
    mockTtl.mockResolvedValue(20);

    const result = await checkRateLimit("api:tenant-1", 100, 60);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("gracefully allows traffic when Redis is unavailable", async () => {
    mockIncr.mockRejectedValue(new Error("Connection refused"));

    const result = await checkRateLimit("api:tenant-1", 100, 60);

    // Fail open: allow request if Redis is down
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(-1);
  });
});

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a limiter with preset max and window", async () => {
    mockIncr.mockResolvedValue(1);
    mockTtl.mockResolvedValue(60);

    const limiter = createRateLimiter({ max: 50, windowSeconds: 120 });
    const result = await limiter("tenant-1");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(49);
  });

  it("uses the provided prefix for the Redis key", async () => {
    mockIncr.mockResolvedValue(1);
    mockTtl.mockResolvedValue(60);

    const limiter = createRateLimiter({
      max: 100,
      windowSeconds: 60,
      prefix: "submit",
    });
    await limiter("tenant-1");

    expect(mockIncr).toHaveBeenCalledWith("rl:submit:tenant-1");
  });
});
