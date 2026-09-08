// src/cache/series-cacher.ts
// Background downloader for followed series episodes.
//
// When a user follows a series, this service:
//   1. Fetches the episode list from Xtream API
//   2. Queues each episode for background download
//   3. Downloads one at a time (to avoid saturating bandwidth)
//   4. Stores in disk cache (same cache as on-demand streams)
//   5. Skips already-cached episodes
//   6. Respects disk space limits (stops if disk full)
//
// Like: Netflix's "Smart Downloads" or Plex's pre-caching.

import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Episode to download */
interface QueuedEpisode {
  readonly seriesId: number;
  readonly seriesName: string;
  readonly season: number;
  readonly episodeName: string;
  readonly url: string;
}

/** Per-series download bookkeeping, including the telemetry fields below. */
interface SeriesStats {
  /** Stored directly here rather than derived from currentDownload -- see
   * the getStatus() comment below for why the old derivation was buggy. */
  name: string;
  total: number;
  cached: number;
  /** Episodes this session has attempted (succeeded + failed), for
   * progress/telemetry visibility a caller can't get from cached/total
   * alone once retries or failures are in the mix. */
  attempted: number;
  failed: number;
  /** Message from the most recent failure, if any -- lets a caller/log
   * consumer see *why* progress stalled without grepping the log file. */
  lastError?: string;
  /** Cumulative bytes actually written to disk across all episodes of
   * this series this session (not upstream Content-Length, which some
   * sources omit or lie about -- this is what was really persisted). */
  bytesDownloaded: number;
}

/** Download status for a series */
export interface SeriesCacheStatus {
  seriesId: number;
  seriesName: string;
  totalEpisodes: number;
  cachedEpisodes: number;
  attemptedEpisodes: number;
  failedEpisodes: number;
  bytesDownloaded: number;
  lastError?: string | undefined;
  downloading: boolean;
  currentEpisode?: string | undefined;
}

/**
 * Creates the series cacher service.
 * Manages a download queue and processes it one episode at a time.
 */
export function createSeriesCacher(app: FastifyInstance) {
  const queue: QueuedEpisode[] = [];
  let isProcessing = false;
  let currentDownload: QueuedEpisode | null = null;
  let abortController: AbortController | null = null;

  /** Track which series have been queued (to avoid re-queuing) */
  const queuedSeries = new Set<number>();

  /** Track download stats per series */
  const stats = new Map<number, SeriesStats>();

  /**
   * Queue all episodes of a series for background caching.
   * Fetches the episode list from Xtream, then adds to download queue.
   */
  async function queueSeries(
    seriesId: number,
    seriesName: string,
  ): Promise<{ queued: number; alreadyCached: number }> {
    if (queuedSeries.has(seriesId)) {
      return { queued: 0, alreadyCached: 0 };
    }
    queuedSeries.add(seriesId);

    // Fetch episode list from our own API (uses Xtream cache internally)
    try {
      const response = await app.inject({
        method: "GET",
        url: `/xtream/series/${String(seriesId)}`,
        headers: { cookie: "auth=true" },
      });

      if (response.statusCode !== 200) {
        app.log.warn(
          { seriesId, seriesName, statusCode: response.statusCode },
          "[series-cacher] Failed to fetch episode list",
        );
        return { queued: 0, alreadyCached: 0 };
      }

      const seasons = JSON.parse(response.body) as {
        season: number;
        episodes: { name: string; url: string; id: number }[];
      }[];

      let queued = 0;
      let alreadyCached = 0;

      for (const season of seasons) {
        for (const ep of season.episodes) {
          // Check if already in disk cache
          const cached = await app.diskCache.get(ep.url);
          if (cached) {
            // Close the read stream (we just checked existence)
            cached.stream.destroy();
            alreadyCached++;
            continue;
          }

          queue.push({
            seriesId,
            seriesName,
            season: season.season,
            episodeName: ep.name,
            url: ep.url,
          });
          queued++;
        }
      }

      const totalEps = seasons.reduce((sum, s) => sum + s.episodes.length, 0);
      stats.set(seriesId, {
        name: seriesName,
        total: totalEps,
        cached: alreadyCached,
        attempted: 0,
        failed: 0,
        bytesDownloaded: 0,
      });

      app.log.info(
        { seriesId, seriesName, queued, alreadyCached, totalEpisodes: totalEps },
        "[series-cacher] Queued series for background caching",
      );

      // Start processing if not already running
      void processQueue();

      return { queued, alreadyCached };
    } catch (err) {
      app.log.error(
        { seriesId, seriesName, err: err instanceof Error ? err.message : String(err) },
        "[series-cacher] Error queuing series",
      );
      return { queued: 0, alreadyCached: 0 };
    }
  }

  /** Process download queue one episode at a time */
  async function processQueue(): Promise<void> {
    if (isProcessing) return;
    isProcessing = true;

    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      const episode = next;
      currentDownload = episode;

      const s = stats.get(episode.seriesId);
      if (s) s.attempted++;

      try {
        const bytes = await downloadEpisode(episode);

        // Update stats
        if (s) {
          s.cached++;
          s.bytesDownloaded += bytes;
        }
      } catch (err) {
        // Log and continue with next episode -- one bad episode (a dead
        // upstream link, a transient network blip) shouldn't stall every
        // episode queued behind it.
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (s) {
          s.failed++;
          s.lastError = msg;
        }
        app.log.warn(
          { seriesId: episode.seriesId, episodeName: episode.episodeName, err: msg },
          "[series-cacher] Episode download failed",
        );
      }

      currentDownload = null;

      // Small delay between downloads (rate limiting courtesy)
      await new Promise((r) => setTimeout(r, 2000));
    }

    isProcessing = false;
  }

  /** Download a single episode into disk cache. Returns bytes written. */
  async function downloadEpisode(episode: QueuedEpisode): Promise<number> {
    abortController = new AbortController();
    const startedAt = Date.now();

    app.log.info(
      { seriesName: episode.seriesName, season: episode.season, episodeName: episode.episodeName },
      "[series-cacher] Downloading episode",
    );

    try {
      const upstream = await fetch(episode.url, {
        headers: { "User-Agent": "RareBreed/1.0" },
        signal: abortController.signal,
      });

      if (!upstream.ok || !upstream.body) {
        throw new Error(`Upstream ${String(upstream.status)}`);
      }

      const contentType = upstream.headers.get("content-type") ?? "video/mp4";

      // Stream to disk cache
      const source = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);

      const { stream: toFile } = app.diskCache.createWriteStream(episode.url);

      await pipeline(source, toFile);

      // Commit to cache
      await app.diskCache.commit(episode.url, contentType);

      const durationMs = Date.now() - startedAt;
      const bytes = toFile.bytesWritten;
      const throughputKBs = durationMs > 0 ? Math.round(bytes / 1024 / (durationMs / 1000)) : 0;

      app.log.info(
        { episodeName: episode.episodeName, bytes, durationMs, throughputKBs },
        "[series-cacher] Episode cached",
      );

      abortController = null;
      return bytes;
    } catch (err) {
      // Without this, an aborted or failed download (stop(), a network
      // error, disk full) left its partial file permanently orphaned on
      // disk with no cache metadata -- invisible to every existing
      // accounting path (it's not a committed cache entry, so nothing
      // ever counts it, evicts it, or reports it). Confirmed live: a
      // stopped follow-download left a real 295MB partial file sitting
      // in cache/video/ indefinitely after follow/stop reported success.
      // This mirrors disk-cache.ts's own discard() rationale for the
      // sibling bug already fixed one layer up in stream.ts/transcode.ts
      // (a truncated download silently committed as "complete") -- this
      // was the same class of bug at the point the file is never
      // committed at all. discard() is itself best-effort (a no-op, not
      // an error, if nothing was ever written for this URL -- see its own
      // doc comment in disk-cache.ts), so it's always safe to call here
      // even if the fetch itself failed before any bytes were written.
      await app.diskCache.discard(episode.url);
      abortController = null;
      throw err;
    }
  }

  return {
    /** Queue a followed series for background caching */
    queueSeries,

    /** Get download status for all queued series */
    getStatus(): SeriesCacheStatus[] {
      const result: SeriesCacheStatus[] = [];
      for (const [seriesId, s] of stats) {
        // Previously derived from currentDownload alone, which meant the
        // name (and downloading/currentEpisode) went blank/false for the
        // ~2s courtesy delay between every episode -- not actually
        // between series, just between episodes of the SAME series still
        // actively queued. Confirmed live via 1s-interval polling during
        // a real download. The name now comes from the series' own
        // stored stats, so it stays stable for the whole time a series is
        // queued regardless of the current inter-episode gap.
        result.push({
          seriesId,
          seriesName: s.name,
          totalEpisodes: s.total,
          cachedEpisodes: s.cached,
          attemptedEpisodes: s.attempted,
          failedEpisodes: s.failed,
          bytesDownloaded: s.bytesDownloaded,
          lastError: s.lastError,
          downloading: currentDownload?.seriesId === seriesId,
          currentEpisode:
            currentDownload?.seriesId === seriesId ? currentDownload.episodeName : undefined,
        });
      }
      return result;
    },

    /** Get queue length */
    get queueLength(): number {
      return queue.length;
    },

    /** Whether currently downloading */
    get isDownloading(): boolean {
      return isProcessing;
    },

    /** Stop all downloads (cancel current + clear queue) */
    stop(): void {
      queue.length = 0;
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      isProcessing = false;
      currentDownload = null;
    },

    /** Remove a series from queue (cancel pending episodes) */
    removeSeries(seriesId: number): number {
      const before = queue.length;
      const remaining = queue.filter((e) => e.seriesId !== seriesId);
      queue.length = 0;
      queue.push(...remaining);
      queuedSeries.delete(seriesId);
      stats.delete(seriesId);
      return before - remaining.length;
    },
  };
}

export type SeriesCacher = ReturnType<typeof createSeriesCacher>;
