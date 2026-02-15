import { getRedisClient } from "@/lib/redis";
import { createLogger } from "@/lib/logger";

const log = createLogger("rate-limit");

const KEY_PREFIX = "rl";

export interface RateLimitResult {
  allowed: boolean;
  /** How many requests remain in the current window. -1 when Redis is unavailable. */
  remaining: number;
  /** Seconds until the window resets. Only set when `allowed` is false. */
  retryAfter?: number;
}

/**
 * Fixed-window rate limiter backed by Redis INCR + EXPIRE.
 *
 * @param key      Unique identifier (e.g. `api:tenant-123` or `submit:tenant-123`)
 * @param max      Maximum requests allowed in the window
 * @param windowS  Window length in seconds
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowS: number,
): Promise<RateLimitResult> {
  try {
    const redis = getRedisClient();
    const redisKey = `${KEY_PREFIX}:${key}`;

    const count = await redis.incr(redisKey);

    // Set expiry only on the first increment (TTL will be -1 if no expiry set)
    const ttl = await redis.ttl(redisKey);
    if (ttl === -1) {
      await redis.expire(redisKey, windowS);
    }

    if (count > max) {
      return { allowed: false, remaining: 0, retryAfter: ttl > 0 ? ttl : windowS };
    }

    return { allowed: true, remaining: max - count };
  } catch (err) {
    // Fail open: if Redis is unavailable, allow the request
    log.warn({ err }, "rate limit check failed — allowing request");
    return { allowed: true, remaining: -1 };
  }
}

/**
 * Create a rate limiter function with preset configuration.
 */
export function createRateLimiter(opts: {
  max: number;
  windowSeconds: number;
  prefix?: string;
}): (identifier: string) => Promise<RateLimitResult> {
  const { max, windowSeconds, prefix = "api" } = opts;
  return (identifier: string) =>
    checkRateLimit(`${prefix}:${identifier}`, max, windowSeconds);
}
