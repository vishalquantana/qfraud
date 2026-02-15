import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Create mock Redis methods
// ---------------------------------------------------------------------------
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockSetex = vi.fn();
const mockDel = vi.fn();
const mockScanStream = vi.fn();

// Mock the redis module so cache.ts gets our mock client
const mockRedisClient = {
  get: mockGet,
  set: mockSet,
  setex: mockSetex,
  del: mockDel,
  scanStream: mockScanStream,
};

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => mockRedisClient,
  resetRedisClient: vi.fn(),
}));

// Import AFTER mocking
import {
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheDeletePattern,
  withCache,
} from "@/lib/cache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// cacheGet
// ---------------------------------------------------------------------------
describe("cacheGet", () => {
  it("returns parsed JSON on cache hit", async () => {
    const data = { id: 1, name: "test" };
    mockGet.mockResolvedValueOnce(JSON.stringify(data));

    const result = await cacheGet<{ id: number; name: string }>("key:1");

    expect(mockGet).toHaveBeenCalledWith("key:1");
    expect(result).toEqual(data);
  });

  it("returns null on cache miss", async () => {
    mockGet.mockResolvedValueOnce(null);

    const result = await cacheGet("key:missing");

    expect(result).toBeNull();
  });

  it("returns null and does not throw when Redis errors", async () => {
    mockGet.mockRejectedValueOnce(new Error("connection refused"));

    const result = await cacheGet("key:err");

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cacheSet
// ---------------------------------------------------------------------------
describe("cacheSet", () => {
  it("serializes value and stores with default TTL", async () => {
    const data = { score: 95 };
    mockSetex.mockResolvedValueOnce("OK");

    await cacheSet("key:2", data);

    expect(mockSetex).toHaveBeenCalledWith("key:2", 300, JSON.stringify(data));
  });

  it("uses custom TTL when provided", async () => {
    mockSetex.mockResolvedValueOnce("OK");

    await cacheSet("key:3", "hello", 60);

    expect(mockSetex).toHaveBeenCalledWith("key:3", 60, JSON.stringify("hello"));
  });

  it("stores without TTL when ttlSeconds is 0", async () => {
    mockSet.mockResolvedValueOnce("OK");

    await cacheSet("key:no-ttl", "val", 0);

    expect(mockSet).toHaveBeenCalledWith("key:no-ttl", JSON.stringify("val"));
    expect(mockSetex).not.toHaveBeenCalled();
  });

  it("does not throw when Redis errors", async () => {
    mockSetex.mockRejectedValueOnce(new Error("connection refused"));

    await expect(cacheSet("key:err", "v")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// cacheDelete
// ---------------------------------------------------------------------------
describe("cacheDelete", () => {
  it("deletes the given key", async () => {
    mockDel.mockResolvedValueOnce(1);

    await cacheDelete("key:4");

    expect(mockDel).toHaveBeenCalledWith("key:4");
  });

  it("does not throw when Redis errors", async () => {
    mockDel.mockRejectedValueOnce(new Error("connection refused"));

    await expect(cacheDelete("key:err")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// cacheDeletePattern
// ---------------------------------------------------------------------------
describe("cacheDeletePattern", () => {
  it("uses SCAN stream + DEL to remove matching keys", async () => {
    // Simulate a scanStream that emits one batch of keys then ends
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const fakeStream = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = cb;
        return fakeStream;
      }),
    };
    mockScanStream.mockReturnValueOnce(fakeStream);
    mockDel.mockResolvedValue(2);

    const promise = cacheDeletePattern("tenant:123:*");

    // Emit data + end
    handlers["data"](["tenant:123:a", "tenant:123:b"]);
    handlers["end"]();

    await promise;

    expect(mockScanStream).toHaveBeenCalledWith({ match: "tenant:123:*", count: 100 });
    expect(mockDel).toHaveBeenCalledWith("tenant:123:a", "tenant:123:b");
  });

  it("handles empty scan result gracefully", async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const fakeStream = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = cb;
        return fakeStream;
      }),
    };
    mockScanStream.mockReturnValueOnce(fakeStream);

    const promise = cacheDeletePattern("nothing:*");

    handlers["end"]();

    await promise;

    expect(mockDel).not.toHaveBeenCalled();
  });

  it("does not throw when Redis errors", async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const fakeStream = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = cb;
        return fakeStream;
      }),
    };
    mockScanStream.mockReturnValueOnce(fakeStream);

    const promise = cacheDeletePattern("err:*");

    handlers["error"](new Error("scan failed"));

    await expect(promise).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// withCache (cache-aside)
// ---------------------------------------------------------------------------
describe("withCache", () => {
  it("returns cached value on hit without calling fn", async () => {
    const cached = { id: 1, title: "cached" };
    mockGet.mockResolvedValueOnce(JSON.stringify(cached));
    const fn = vi.fn();

    const result = await withCache("key:hit", 60, fn);

    expect(result).toEqual(cached);
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls fn and caches result on miss", async () => {
    mockGet.mockResolvedValueOnce(null);
    mockSetex.mockResolvedValueOnce("OK");
    const fresh = { id: 2, title: "fresh" };
    const fn = vi.fn().mockResolvedValueOnce(fresh);

    const result = await withCache("key:miss", 120, fn);

    expect(result).toEqual(fresh);
    expect(fn).toHaveBeenCalledOnce();
    expect(mockSetex).toHaveBeenCalledWith(
      "key:miss",
      120,
      JSON.stringify(fresh),
    );
  });

  it("falls through to fn when Redis get fails", async () => {
    mockGet.mockRejectedValueOnce(new Error("connection refused"));
    const fresh = { id: 3, title: "fallback" };
    const fn = vi.fn().mockResolvedValueOnce(fresh);

    const result = await withCache("key:redis-down", 60, fn);

    expect(result).toEqual(fresh);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("returns fn result even when cacheSet fails after miss", async () => {
    mockGet.mockResolvedValueOnce(null);
    mockSetex.mockRejectedValueOnce(new Error("write failed"));
    const fresh = { id: 4, title: "still works" };
    const fn = vi.fn().mockResolvedValueOnce(fresh);

    const result = await withCache("key:set-fail", 60, fn);

    expect(result).toEqual(fresh);
  });
});
