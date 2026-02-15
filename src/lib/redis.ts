import Redis from "ioredis";
import { createLogger } from "@/lib/logger";

const log = createLogger("redis");

let redisClient: Redis | null = null;

/**
 * Returns a singleton Redis client.
 *
 * Connects to `process.env.REDIS_URL` or defaults to `redis://localhost:6379`.
 * Connection errors are logged but never crash the process.
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });

    redisClient.on("error", (err: Error) => {
      log.warn({ err }, "connection error");
    });
  }
  return redisClient;
}

/**
 * Reset the singleton (useful in tests to get a fresh mock).
 */
export function resetRedisClient(): void {
  if (redisClient) {
    redisClient.disconnect();
  }
  redisClient = null;
}

export { redisClient };
