// src/routes/watch.ts
// Watch history + auto-delete API endpoints.
// Frontend sends completed episodes; backend tracks them for auto-cleanup.
//
// Like: Spring @RestController + @Autowired CacheManager

import type { FastifyInstance } from "fastify";
import type { WatchedCleaner } from "../cache/watched-cleaner.js";

// Augment Fastify types
declare module "fastify" {
  interface FastifyInstance {
    watchedCleaner: WatchedCleaner;
  }
}

interface ReportRequest {
  readonly episodes: {
    readonly url: string;
    readonly name: string;
    readonly completedAt?: number;
  }[];
}

interface CleanupRequest {
  readonly urls: string[];
}

/**
 * Registers watch-related API routes:
 *   POST /watch/report-completed — frontend reports finished episodes
 *   POST /watch/cleanup          — manually delete specific URLs from cache
 *   GET  /watch/pending          — list episodes awaiting auto-delete
 *   POST /watch/run-cleanup      — manually trigger the cleaner
 *
 * @param app - Fastify instance with diskCache + watchedCleaner decorated.
 */
export async function watchRoutes(app: FastifyInstance): Promise<void> {
  // POST /watch/report-completed — frontend syncs completed episodes
  app.post<{ Body: ReportRequest }>("/report-completed", async (request, reply) => {
    const { episodes } = request.body;

    if (!episodes || !Array.isArray(episodes)) {
      return await reply.status(400).send({ error: "Missing episodes array" });
    }

    const added = await app.watchedCleaner.reportCompleted(episodes);
    return await reply.send({
      added,
      total: episodes.length,
      retentionDays: app.watchedCleaner.retentionDays,
    });
  });

  // POST /watch/cleanup — manually delete specific URLs from cache
  app.post<{ Body: CleanupRequest }>("/cleanup", async (request, reply) => {
    const { urls } = request.body;

    if (!urls || !Array.isArray(urls)) {
      return await reply.status(400).send({ error: "Missing urls array" });
    }

    let deleted = 0;
    for (const url of urls) {
      try {
        await app.diskCache.del(url);
        deleted++;
      } catch {
        // file might not exist — skip
      }
    }

    return await reply.send({ deleted, total: urls.length });
  });

  // GET /watch/pending — show episodes waiting to be auto-deleted
  app.get("/pending", async (_request, reply) => {
    const log = await app.watchedCleaner.getLog();
    const retentionMs = app.watchedCleaner.retentionDays * 24 * 60 * 60 * 1000;

    const entries = log.map((e) => ({
      url: e.url,
      name: e.name,
      completedAt: new Date(e.completedAt).toISOString(),
      deletesIn: Math.max(0, Math.round((e.completedAt + retentionMs - Date.now()) / 3600000)) + " hours",
    }));

    return await reply.send({
      retentionDays: app.watchedCleaner.retentionDays,
      pending: entries,
    });
  });

  // POST /watch/run-cleanup — manually trigger the cleaner (for testing)
  app.post("/run-cleanup", async (_request, reply) => {
    const result = await app.watchedCleaner.cleanup();
    return await reply.send(result);
  });
}
