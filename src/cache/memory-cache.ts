// src/cache/memory-cache.ts
// L1 in-memory cache — like Caffeine with LRU eviction + TTL.
// Fastest layer: ~0.001ms access (no network, no serialization).
// Process-local — lost on restart, not shared across instances.

import { LRUCache } from "lru-cache";
import type { CacheStore } from "./cache.js";

interface MemoryCacheOptions {
  /** Max number of entries (like Caffeine's maximumSize). Default: 50 */
  readonly max?: number;
  /** Default TTL in milliseconds (like expireAfterWrite). Default: 5 min */
  readonly ttlMs?: number;
}

/**
 * LRU in-memory cache implementing the CacheStore interface.
 * Bounded by max entries + TTL. Evicts least-recently-used entries when full.
 *
 * @param options - max entries and default TTL.
 * @returns CacheStore backed by in-process LRU map.
 */
export function createMemoryCache(options: MemoryCacheOptions = {}): CacheStore {
  const { max = 50, ttlMs = 5 * 60_000 } = options;

  // LRUCache<key type, value type>
  // Like: Caffeine.newBuilder().maximumSize(max).expireAfterWrite(ttl).build()
  const store = new LRUCache<string, string>({
    max,
    ttl: ttlMs,
  });

  return {
    name: "memory",

    get(key: string): Promise<string | undefined> {
      return Promise.resolve(store.get(key));
    },

    set(key: string, value: string, ttl?: number): Promise<void> {
      store.set(key, value, { ttl: ttl ?? ttlMs });
      return Promise.resolve();
    },

    del(key: string): Promise<void> {
      store.delete(key);
      return Promise.resolve();
    },

    clear(): Promise<void> {
      store.clear();
      return Promise.resolve();
    },

    has(key: string): Promise<boolean> {
      return Promise.resolve(store.has(key));
    },
  };
}
