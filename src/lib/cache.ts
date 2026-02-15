import { createLogger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";

const log = createLogger("cache");

/**
 * Get a value from cache, parsed as JSON.
 * Returns null on miss or if Redis is unavailable.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedisClient().get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    log.warn({ err }, "cacheGet error");
    return null;
  }
}

/**
 * Set a value in cache, serialized as JSON.
 *
 * @param key        Cache key
 * @param value      Any JSON-serializable value
 * @param ttlSeconds Time-to-live in seconds. Defaults to 300 (5 min). Pass 0 for no expiry.
 */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number = 300,
): Promise<void> {
  try {
    const serialized = JSON.stringify(value);
    if (ttlSeconds > 0) {
      await getRedisClient().setex(key, ttlSeconds, serialized);
    } else {
      await getRedisClient().set(key, serialized);
    }
  } catch (err) {
    log.warn({ err }, "cacheSet error");
  }
}

/**
 * Delete a single key from cache.
 */
export async function cacheDelete(key: string): Promise<void> {
  try {
    await getRedisClient().del(key);
  } catch (err) {
    log.warn({ err }, "cacheDelete error");
  }
}

/**
 * Delete all keys matching a glob pattern using SCAN + DEL.
 * This avoids the `KEYS` command which blocks Redis on large datasets.
 */
export async function cacheDeletePattern(pattern: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const stream = redis.scanStream({ match: pattern, count: 100 });

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (keys: string[]) => {
        if (keys.length > 0) {
          redis.del(...keys).catch((err: Error) => {
            log.warn({ err }, "cacheDeletePattern DEL error");
          });
        }
      });
      stream.on("end", () => resolve());
      stream.on("error", (err: Error) => {
        log.warn({ err }, "cacheDeletePattern SCAN error");
        resolve(); // resolve instead of reject to avoid throwing
      });
    });
  } catch (err) {
    log.warn({ err }, "cacheDeletePattern error");
  }
}

/**
 * Cache-aside pattern: return the cached value if it exists, otherwise
 * call `fn`, cache the result, and return it.
 *
 * If Redis is unavailable the function always falls through to `fn`.
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  // Try reading from cache
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;

  // Cache miss (or Redis error) - call the source function
  const result = await fn();

  // Best-effort cache write
  await cacheSet(key, result, ttlSeconds);

  return result;
}
