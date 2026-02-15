import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Override the global prisma mock from setup.ts so we test the REAL module
vi.mock("@/lib/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/prisma")>();
  return actual;
});

// Mock dependencies that prisma.ts imports
vi.mock("@/generated/prisma/client", () => ({
  PrismaClient: class MockPrismaClient {
    $connect = vi.fn();
    $disconnect = vi.fn();
  },
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class MockPrismaPg {},
}));

import { getPoolConfig } from "@/lib/prisma";

describe("prisma pool configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns a pool config with the DATABASE_URL connection string", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@myhost:5432/mydb";
    const config = getPoolConfig();

    expect(config.connectionString).toBe(
      "postgresql://user:pass@myhost:5432/mydb",
    );
  });

  it("uses a sensible default max pool size", () => {
    const config = getPoolConfig();
    expect(config.max).toBeGreaterThanOrEqual(10);
  });

  it("allows overriding pool size via DB_POOL_MAX env var", () => {
    process.env.DB_POOL_MAX = "20";
    const config = getPoolConfig();
    expect(config.max).toBe(20);
  });

  it("sets idle timeout to reclaim unused connections", () => {
    const config = getPoolConfig();
    expect(config.idleTimeoutMillis).toBeDefined();
    expect(config.idleTimeoutMillis).toBeGreaterThan(0);
  });

  it("sets a connection timeout", () => {
    const config = getPoolConfig();
    expect(config.connectionTimeoutMillis).toBeDefined();
    expect(config.connectionTimeoutMillis).toBeGreaterThan(0);
  });

  it("sets statement_timeout via options for query guardrails", () => {
    const config = getPoolConfig();
    expect(config.options).toContain("statement_timeout");
  });
});
