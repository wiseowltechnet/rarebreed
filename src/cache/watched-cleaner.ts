// src/cache/watched-cleaner.ts
// Periodically deletes watched episodes from disk cache after a retention period.
//
// Flow:
//   1. Frontend reports completed episodes via POST /watch/report-completed
//   2. Server stores them in a JSON file (watched-log.json)
//   3. Every hour, this cleaner scans the log and deletes entries older than X days
//
// Like: @Scheduled(cron = "0 0 * * * *") in Spring + CacheEvictionPolicy
//
// Why server-side log instead of just localStorage?
//   - Survives browser cache clear
//   - Works even if frontend is not open
//   - Single source of truth for the cleaner

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { DiskCache } from "./disk-cache.js";

/** A completed episode record (server-side) */
export interface CompletedEpisode {
  /** Stream URL (cache key) */
  readonly url: string;
  /** Episode name (for logging) */
  readonly name: string;
  /** When the episode was marked as completed (epoch ms) */
  readonly completedAt: number;
}

interface WatchedCleanerOptions {
  /** Path to the watched-log JSON file */
  readonly logPath?: string;
  /** Days to keep completed episodes in cache before deletion. Default: 3 */
  readonly retentionDays?: number;
  /** How often to run the cleaner (ms). Default: 1 hour */
  readonly intervalMs?: number;
}

/**
 * Creates the watched-episode cleaner.
 * Call start() to begin periodic cleanup, stop() to halt.
 *
 * @param diskCache - The disk cache instance to delete from
 * @param options - Retention period and interval config
 */
export function createWatchedCleaner(diskCache: DiskCache, options: WatchedCleanerOptions = {}) {
  const {
    logPath = path.join(process.cwd(), "data", "watched-log.json"),
    retentionDays = Number(process.env.WATCHED_RETENTION_DAYS) || 3,
    intervalMs = 60 * 60 * 1000, // 1 hour
  } = options;

  let timer: ReturnType<typeof setInterval> | null = null;

  /** Ensure the data directory exists */
  async function ensureDir(): Promise<void> {
    const dir = path.dirname(logPath);
    await fs.mkdir(dir, { recursive: true });
  }

  /** Load the watched log from disk */
  async function loadLog(): Promise<CompletedEpisode[]> {
    if (!existsSync(logPath)) return [];
    try {
      const raw = await fs.readFile(logPath, "utf-8");
      return JSON.parse(raw) as CompletedEpisode[];
    } catch {
      return []; // corrupted — start fresh
    }
  }

  /** Save the watched log to disk */
  async function saveLog(entries: CompletedEpisode[]): Promise<void> {
    await ensureDir();
    await fs.writeFile(logPath, JSON.stringify(entries, null, 2));
  }

  return {
    /** Current retention days setting */
    retentionDays,

    /**
     * Report one or more episodes as completed (called by the API route).
     * Idempotent — won't duplicate entries for the same URL.
     */
    async reportCompleted(
      episodes: { url: string; name: string; completedAt?: number }[],
    ): Promise<number> {
      const log = await loadLog();
      let added = 0;

      for (const ep of episodes) {
        // Skip if already in the log
        if (log.some((e) => e.url === ep.url)) continue;

        log.push({
          url: ep.url,
          name: ep.name,
          completedAt: ep.completedAt ?? Date.now(),
        });
        added++;
      }

      if (added > 0) {
        await saveLog(log);
      }
      return added;
    },

    /**
     * Run the cleanup: delete cached episodes that were completed > retentionDays ago.
     * Returns the number of entries deleted.
     */
    async cleanup(): Promise<{ deleted: number; remaining: number }> {
      const log = await loadLog();
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

      const stale = log.filter((e) => e.completedAt < cutoff);
      const keep = log.filter((e) => e.completedAt >= cutoff);

      let deleted = 0;
      for (const entry of stale) {
        const success = await diskCache.del(entry.url);
        if (success) {
          deleted++;
          console.log(
            `[watched-cleaner] Deleted: ${entry.name} (watched ${String(Math.round((Date.now() - entry.completedAt) / 86400000))}d ago)`,
          );
        }
      }

      // Save the trimmed log (only entries still within retention window)
      await saveLog(keep);

      return { deleted, remaining: keep.length };
    },

    /** Get the current log (for the API/debugging) */
    async getLog(): Promise<CompletedEpisode[]> {
      return loadLog();
    },

    /** Start the periodic cleanup timer */
    start(): void {
      if (timer) return; // already running
      console.log(
        `[watched-cleaner] Started — retention: ${String(retentionDays)} days, interval: ${String(intervalMs / 60000)} min`,
      );

      // Run immediately on start, then on interval
      void this.cleanup().then(({ deleted, remaining }) => {
        if (deleted > 0) {
          console.log(
            `[watched-cleaner] Initial cleanup: deleted ${String(deleted)}, ${String(remaining)} pending`,
          );
        }
      });

      timer = setInterval(() => {
        void this.cleanup().then(({ deleted, remaining }) => {
          if (deleted > 0) {
            console.log(
              `[watched-cleaner] Periodic cleanup: deleted ${String(deleted)}, ${String(remaining)} pending`,
            );
          }
        });
      }, intervalMs);
    },

    /** Stop the periodic cleanup timer */
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

export type WatchedCleaner = ReturnType<typeof createWatchedCleaner>;
