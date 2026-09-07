// src/cache/tiered-cache.ts
// Two-tier cache: L1 (memory) → L2 (Redis) → origin.
// Like Spring's CompositeCacheManager or Caffeine LoadingCache + Redis write-through.
//
// Flow on get:
//   L1 hit  → return immediately (~0.001ms)
//   L1 miss → check L2 (~1ms)
//   L2 hit  → return + backfill L1
//   L2 miss → caller fetches from origin, then calls set() to populate both
//
// Flow on set:
//   Write to L1 AND L2 simultaneously (write-through)

import type { CacheStore } from "./cache.js";

interface TieredCacheOptions {
  /** L1 in-memory cache (fast, local, bounded) */
  readonly l1: CacheStore;
  /** L2 shared cache — Redis (slower, shared, persistent) */
  readonly l2: CacheStore;
}

/**
 * Creates a tiered cache that checks L1 first, then L2.
 * On set, writes to both layers (write-through).
 * Like Spring's CompositeCacheManager with read-through + write-through.
 *
 * @param options - L1 and L2 cache store implementations.
 * @returns CacheStore that orchestrates both layers.
 */
export function createTieredCache(options: TieredCacheOptions): CacheStore {
  const { l1, l2 } = options;

  return {
    name: "tiered",

    async get(key: string): Promise<string | undefined> {
      // 1. Check L1 (memory) — ~0.001ms
      const fromL1 = await l1.get(key);
      if (fromL1 !== undefined) {
        return fromL1; // L1 hit — fastest path
      }

      // 2. Check L2 (Redis) — ~1ms
      const fromL2 = await l2.get(key);
      if (fromL2 !== undefined) {
        // L2 hit — backfill L1 so next request is instant
        // Like Caffeine's LoadingCache populating from the loader
        await l1.set(key, fromL2);
        return fromL2;
      }

      // 3. Both miss — caller must fetch from origin and call set()
      return undefined;
    },

    async set(key: string, value: string, ttlMs?: number): Promise<void> {
      // Write-through: populate BOTH layers simultaneously
      // Like @CachePut writing to all configured cache managers
      await Promise.all([l1.set(key, value, ttlMs), l2.set(key, value, ttlMs)]);
    },

    async del(key: string): Promise<void> {
      // Evict from both layers (cache invalidation)
      await Promise.all([l1.del(key), l2.del(key)]);
    },

    async clear(): Promise<void> {
      // Clear both layers
      await Promise.all([l1.clear(), l2.clear()]);
    },

    async has(key: string): Promise<boolean> {
      // Check L1 first, then L2
      return (await l1.has(key)) || (await l2.has(key));
    },
  };
}
