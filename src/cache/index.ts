// src/cache/index.ts
// Barrel export — like a Java package-info.java or module-info.java
// Consumers import from "./cache/index.js" and get everything they need

export type { CacheStore } from "./cache.js";
export { createMemoryCache } from "./memory-cache.js";
export { createRedisCache } from "./redis-cache.js";
export { createTieredCache } from "./tiered-cache.js";
