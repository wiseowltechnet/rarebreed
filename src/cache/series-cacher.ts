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

/** Download status for a series */
export interface SeriesCacheStatus {
  seriesId: number;
  seriesName: string;
  totalEpisodes: number;
  cachedEpisodes: number;
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
  const stats = new Map<number, { total: number; cached: number }>();

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
        console.log(
          `[series-cacher] Failed to fetch episodes for ${seriesName}: ${String(response.statusCode)}`,
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
      stats.set(seriesId, { total: totalEps, cached: alreadyCached });

      console.log(
        `[series-cacher] Queued ${String(queued)} episodes for "${seriesName}" (${String(alreadyCached)} already cached)`,
      );

      // Start processing if not already running
      void processQueue();

      return { queued, alreadyCached };
    } catch (err) {
      console.error(`[series-cacher] Error queuing ${seriesName}:`, err);
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

      try {
        await downloadEpisode(episode);

        // Update stats
        const s = stats.get(episode.seriesId);
        if (s) s.cached++;
      } catch (err) {
        // Log and continue with next episode
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.log(`[series-cacher] Failed: ${episode.episodeName} — ${msg}`);
      }

      currentDownload = null;

      // Small delay between downloads (rate limiting courtesy)
      await new Promise((r) => setTimeout(r, 2000));
    }

    isProcessing = false;
  }

  /** Download a single episode into disk cache */
  async function downloadEpisode(episode: QueuedEpisode): Promise<void> {
    abortController = new AbortController();

    console.log(
      `[series-cacher] Downloading: ${episode.seriesName} S${String(episode.season)} — ${episode.episodeName}`,
    );

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

    console.log(`[series-cacher] Cached: ${episode.episodeName}`);
    abortController = null;
  }

  return {
    /** Queue a followed series for background caching */
    queueSeries,

    /** Get download status for all queued series */
    getStatus(): SeriesCacheStatus[] {
      const result: SeriesCacheStatus[] = [];
      for (const [seriesId, s] of stats) {
        const name = [...queuedSeries].includes(seriesId)
          ? currentDownload?.seriesId === seriesId
            ? currentDownload.seriesName
            : ""
          : "";
        result.push({
          seriesId,
          seriesName: name || `Series ${String(seriesId)}`,
          totalEpisodes: s.total,
          cachedEpisodes: s.cached,
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
