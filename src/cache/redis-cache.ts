// src/cache/redis-cache.ts
// L2 Redis cache — shared across instances, survives restarts.
// Like Spring's RedisCacheManager + RedisTemplate.
//
// If Redis is unavailable, methods return gracefully (miss/no-op).
// The tiered cache will fall through to origin — Redis is OPTIONAL.
// This is the "circuit breaker" pattern: degrade, don't crash.

import { Redis } from "ioredis";
import type { CacheStore } from "./cache.js";

interface RedisCacheOptions {
  /** Redis connection URL. Default: redis://localhost:6379 */
  readonly url?: string;
  /** Key prefix to namespace entries (like Spring's cache name). Default: "rarebreed:" */
  readonly prefix?: string;
  /** Default TTL in milliseconds. Default: 10 min */
  readonly ttlMs?: number;
}

/**
 * Redis-backed cache implementing the CacheStore interface.
 * Shared across server instances. Persists across restarts.
 * Gracefully degrades if Redis is unavailable (returns miss, doesn't throw).
 *
 * @param options - Redis URL, key prefix, and default TTL.
 * @returns CacheStore backed by Redis.
 */
export function createRedisCache(options: RedisCacheOptions = {}): CacheStore {
  const {
    url = process.env.REDIS_URL ?? "redis://localhost:6379",
    prefix = "rarebreed:",
    ttlMs = 10 * 60_000,
  } = options;

  // ioredis connects lazily on first command (like Lettuce connection pool)
  // lazyConnect: true means we don't block startup if Redis isn't ready
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1, // fail fast, don't block the event loop
    retryStrategy(times: number) {
      // Exponential backoff: 100ms, 200ms, 400ms... max 3s
      // Like Lettuce's reconnect with backoff
      if (times > 5) return null; // stop retrying after 5 attempts
      return Math.min(times * 100, 3_000);
    },
  });

  // Connect (non-blocking, errors handled gracefully)
  redis.connect().catch(() => {
    // Intentionally swallowed — Redis is optional
  });

  // Suppress unhandled error events (Redis down is expected in dev)
  redis.on("error", () => {
    // Silently ignore — graceful degradation handles this per-operation
  });

  const withKey = (key: string): string => `${prefix}${key}`;

  return {
    name: "redis",

    async get(key: string): Promise<string | undefined> {
      try {
        const value = await redis.get(withKey(key));
        // Redis returns null on miss — we normalize to undefined
        return value ?? undefined;
      } catch {
        // Redis down — treat as cache miss (graceful degradation)
        return undefined;
      }
    },

    async set(key: string, value: string, ttl?: number): Promise<void> {
      try {
        // PX = expire in milliseconds (like PEXPIRE)
        // Like: redisTemplate.opsForValue().set(key, value, ttl, MILLISECONDS)
        await redis.set(withKey(key), value, "PX", ttl ?? ttlMs);
      } catch {
        // Redis down — silently skip (data still served from origin)
      }
    },

    async del(key: string): Promise<void> {
      try {
        await redis.del(withKey(key));
      } catch {
        // Redis down — no-op
      }
    },

    async clear(): Promise<void> {
      try {
        // Find all keys with our prefix and delete them
        // Like: RedisTemplate.delete(RedisTemplate.keys("rarebreed:*"))
        const keys = await redis.keys(`${prefix}*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } catch {
        // Redis down — no-op
      }
    },

    async has(key: string): Promise<boolean> {
      try {
        const exists = await redis.exists(withKey(key));
        return exists === 1;
      } catch {
        return false;
      }
    },
  };
}
