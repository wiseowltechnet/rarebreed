// src/cache/disk-cache.ts
// Disk-based stream cache — stores video segments as files.
// LRU eviction by last-access time, bounded by available disk space.
// Like: Ehcache disk tier or Nginx proxy_cache.
//
// NOT implementing the CacheStore interface (that's for string key/value).
// This is a separate, binary-aware cache for streaming video data.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync, createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { checkDiskSpace } from "./disk-utils.js";
import type { ReadStream, WriteStream } from "node:fs";

interface DiskCacheMetadata {
  readonly url: string;
  readonly size: number;
  readonly contentType: string;
  readonly createdAt: string;
  lastAccessedAt: string;
  /** If true, this entry is "saved" and will NOT be evicted by LRU */
  saved: boolean;
  /** Human-readable name (from playlist metadata) */
  name?: string;
}

interface DiskCacheOptions {
  /** Directory to store cached files. Default: ./cache/video */
  readonly cacheDir?: string;
  /** Minimum free disk percentage to maintain. Default: 0.10 (10%) */
  readonly minFreeRatio?: number;
}

interface CacheEntry {
  readonly filePath: string;
  readonly meta: DiskCacheMetadata;
  readonly stream: ReadStream;
}

/**
 * Creates a disk-based video cache.
 * Stores streams as binary files, evicts LRU when disk gets full.
 * Like Ehcache's disk persistence or Nginx's proxy_cache.
 *
 * @param options - Cache directory and eviction threshold.
 * @returns Disk cache with get/put/evict operations.
 */
export async function createDiskCache(options: DiskCacheOptions = {}) {
  const { cacheDir = path.join(process.cwd(), "cache", "video"), minFreeRatio = 0.1 } = options;

  // Ensure cache directory exists (like mkdir -p)
  await fs.mkdir(cacheDir, { recursive: true });

  /** URL → deterministic file path via SHA-256 hash (first 16 chars) */
  function urlToPath(url: string): string {
    const hash = createHash("sha256").update(url).digest("hex");
    return path.join(cacheDir, hash.substring(0, 16));
  }

  function metaPath(filePath: string): string {
    return `${filePath}.meta.json`;
  }

  return {
    /**
     * Check if a URL is cached. Returns a readable stream + metadata on hit.
     * Updates lastAccessedAt (LRU tracking).
     */
    async get(url: string): Promise<CacheEntry | undefined> {
      const fp = urlToPath(url);
      const mp = metaPath(fp);

      if (!existsSync(fp) || !existsSync(mp)) {
        return undefined; // cache miss
      }

      try {
        const raw = await fs.readFile(mp, "utf-8");
        const meta = JSON.parse(raw) as DiskCacheMetadata;

        // Update last access time (LRU tracking)
        meta.lastAccessedAt = new Date().toISOString();
        await fs.writeFile(mp, JSON.stringify(meta));

        return {
          filePath: fp,
          meta,
          stream: createReadStream(fp),
        };
      } catch {
        return undefined; // corrupted metadata — treat as miss
      }
    },

    /**
     * Returns a writable stream to store a URL's content.
     * Call commit() after writing is complete.
     */
    createWriteStream(url: string): { filePath: string; stream: WriteStream } {
      const fp = urlToPath(url);
      return {
        filePath: fp,
        stream: createWriteStream(fp),
      };
    },

    /**
     * Finalizes a cache entry after writing is complete.
     * Stores metadata for LRU eviction.
     */
    async commit(url: string, contentType: string): Promise<void> {
      const fp = urlToPath(url);
      const mp = metaPath(fp);

      const stat = await fs.stat(fp);
      const meta: DiskCacheMetadata = {
        url,
        size: stat.size,
        contentType,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        saved: false,
      };

      await fs.writeFile(mp, JSON.stringify(meta));
    },

    /**
     * Marks a cached URL as "saved" — will NOT be evicted by LRU.
     * Like pinning an entry in Ehcache (eternal=true).
     */
    async save(url: string, name?: string): Promise<boolean> {
      const fp = urlToPath(url);
      const mp = metaPath(fp);

      if (!existsSync(mp)) {
        return false; // not in cache — can't save what doesn't exist
      }

      try {
        const raw = await fs.readFile(mp, "utf-8");
        const meta = JSON.parse(raw) as DiskCacheMetadata;
        meta.saved = true;
        if (name) meta.name = name;
        await fs.writeFile(mp, JSON.stringify(meta));
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Returns all saved (pinned) entries — for the offline library UI.
     */
    async getSaved(): Promise<DiskCacheMetadata[]> {
      const files = await fs.readdir(cacheDir);
      const metaFiles = files.filter((f) => f.endsWith(".meta.json"));
      const saved: DiskCacheMetadata[] = [];

      for (const mf of metaFiles) {
        try {
          const raw = await fs.readFile(path.join(cacheDir, mf), "utf-8");
          const meta = JSON.parse(raw) as DiskCacheMetadata;
          if (meta.saved) {
            saved.push(meta);
          }
        } catch {
          // skip corrupted
        }
      }

      return saved;
    },

    /**
     * Evicts oldest-accessed entries until disk has minFreeRatio free.
     * Like Ehcache's LRU disk eviction or Nginx's proxy_cache_max_size.
     */
    async evict(): Promise<number> {
      const { freeBytes, totalBytes } = await checkDiskSpace(cacheDir);
      const minFreeBytes = totalBytes * minFreeRatio;

      if (freeBytes >= minFreeBytes) {
        return 0; // disk is fine, no eviction needed
      }

      // Load all metadata, sort by lastAccessedAt (oldest first)
      const files = await fs.readdir(cacheDir);
      const metaFiles = files.filter((f) => f.endsWith(".meta.json"));

      interface EvictCandidate {
        dataPath: string;
        metaPath: string;
        size: number;
        lastAccess: string;
      }

      const candidates: EvictCandidate[] = [];

      for (const mf of metaFiles) {
        try {
          const fullMetaPath = path.join(cacheDir, mf);
          const raw = await fs.readFile(fullMetaPath, "utf-8");
          const meta = JSON.parse(raw) as DiskCacheMetadata;

          // Skip saved (pinned) entries — never evict these
          if (meta.saved) continue;

          const dataPath = fullMetaPath.replace(".meta.json", "");
          candidates.push({
            dataPath,
            metaPath: fullMetaPath,
            size: meta.size,
            lastAccess: meta.lastAccessedAt,
          });
        } catch {
          // skip corrupted entries
        }
      }

      // Sort oldest-accessed first (LRU eviction order)
      candidates.sort((a, b) => a.lastAccess.localeCompare(b.lastAccess));

      let freedBytes = 0;
      let evictedCount = 0;
      const bytesNeeded = minFreeBytes - freeBytes;

      for (const candidate of candidates) {
        if (freedBytes >= bytesNeeded) break;

        try {
          await fs.unlink(candidate.dataPath);
          await fs.unlink(candidate.metaPath);
          freedBytes += candidate.size;
          evictedCount++;
        } catch {
          // file already gone — skip
        }
      }

      return evictedCount;
    },

    /** Get cache stats for health/debugging */
    async stats(): Promise<{ entries: number; sizeBytes: number }> {
      const files = await fs.readdir(cacheDir);
      const dataFiles = files.filter((f) => !f.endsWith(".meta.json"));
      let totalSize = 0;

      for (const f of dataFiles) {
        try {
          const stat = await fs.stat(path.join(cacheDir, f));
          totalSize += stat.size;
        } catch {
          // skip
        }
      }

      return { entries: dataFiles.length, sizeBytes: totalSize };
    },

    /** Delete a specific cached URL from disk */
    async del(url: string): Promise<boolean> {
      const fp = urlToPath(url);
      const mp = metaPath(fp);
      try {
        await fs.unlink(fp);
        await fs.unlink(mp);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export type DiskCache = Awaited<ReturnType<typeof createDiskCache>>;
