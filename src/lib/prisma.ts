import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type pg from "pg";

// ---------------------------------------------------------------------------
// Pool configuration
// ---------------------------------------------------------------------------
const DEFAULT_POOL_MAX = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000; // 30s — reclaim idle connections
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000; // 5s — fail fast on connect
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000; // 30s — guard against runaway queries

/**
 * Build a pg.PoolConfig from environment variables.
 * Exported for testing — not intended for direct consumption outside this module.
 */
export function getPoolConfig(): pg.PoolConfig {
  const connectionString =
    process.env.DATABASE_URL ??
    "postgresql://user:password@localhost:5432/quantana_shield";

  const max = process.env.DB_POOL_MAX
    ? parseInt(process.env.DB_POOL_MAX, 10)
    : DEFAULT_POOL_MAX;

  const statementTimeout =
    process.env.DB_STATEMENT_TIMEOUT_MS
      ? parseInt(process.env.DB_STATEMENT_TIMEOUT_MS, 10)
      : DEFAULT_STATEMENT_TIMEOUT_MS;

  return {
    connectionString,
    max,
    idleTimeoutMillis: DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: DEFAULT_CONNECTION_TIMEOUT_MS,
    // Per-connection statement_timeout to prevent runaway queries
    options: `-c statement_timeout=${statementTimeout}`,
  };
}

// ---------------------------------------------------------------------------
// Prisma singleton
// ---------------------------------------------------------------------------
const globalForPrisma = globalThis as unknown as {
  prisma: InstanceType<typeof PrismaClient> | undefined;
};

function createPrismaClient() {
  const poolConfig = getPoolConfig();
  const adapter = new PrismaPg(poolConfig);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
