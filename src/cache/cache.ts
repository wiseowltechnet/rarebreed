// src/cache/cache.ts
// Replaces: Spring's Cache / CacheManager interface
// Defines the contract for ANY cache implementation (LRU, Redis, Tiered)
// Business code depends on this interface, not concrete implementations.
//
// All methods are async (Promise) because Redis is network I/O.
// LRU is synchronous internally but wraps in Promise for compatibility.
// Like Java's CompletableFuture<T> — unifies sync and async behind one API.

/**
 * Cache store contract — like Spring's Cache interface.
 * Implementations: MemoryCache (Caffeine-like), RedisCache, TieredCache.
 */
export interface CacheStore {
  /** Retrieve a value by key. Returns undefined on miss. */
  get(key: string): Promise<string | undefined>;

  /** Store a value with optional TTL in milliseconds. */
  set(key: string, value: string, ttlMs?: number): Promise<void>;

  /** Delete a specific key. */
  del(key: string): Promise<void>;

  /** Remove all entries. */
  clear(): Promise<void>;

  /** Check if a key exists without retrieving the value. */
  has(key: string): Promise<boolean>;

  /** Human-readable name for logging (like Cache.getName() in Spring). */
  readonly name: string;
}
