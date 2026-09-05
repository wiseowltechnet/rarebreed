// src/routes/follow.ts
// Follow/sync API — frontend sends followed series, backend queues auto-caching.
//
// Like: Netflix Smart Downloads background service.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SeriesCacher } from "../cache/series-cacher.js";

// Augment Fastify types
declare module "fastify" {
  interface FastifyInstance {
    seriesCacher: SeriesCacher;
  }
}

interface SyncRequest {
  readonly series: {
    readonly seriesId: number;
    readonly name: string;
  }[];
}

/**
 * Registers follow/sync routes:
 *   POST /follow/sync     — frontend sends followed series, triggers auto-cache
 *   GET  /follow/status   — returns download progress for all queued series
 *   POST /follow/stop     — stop all background downloads
 *   POST /follow/remove/:id — remove a series from download queue
 */
export async function followRoutes(app: FastifyInstance): Promise<void> {
  // POST /follow/sync — sync followed series for auto-caching
  app.post<{ Body: SyncRequest }>("/sync", async (request: FastifyRequest, reply: FastifyReply) => {
    const { series } = request.body as SyncRequest;

    if (!series || !Array.isArray(series)) {
      return await reply.status(400).send({ error: "Missing series array" });
    }

    const results: { seriesId: number; name: string; queued: number; alreadyCached: number }[] = [];

    for (const s of series) {
      const { queued, alreadyCached } = await app.seriesCacher.queueSeries(s.seriesId, s.name);
      results.push({ seriesId: s.seriesId, name: s.name, queued, alreadyCached });
    }

    return await reply.send({
      synced: results,
      queueLength: app.seriesCacher.queueLength,
      isDownloading: app.seriesCacher.isDownloading,
    });
  });

  // GET /follow/status — download progress
  app.get("/status", async (_request: FastifyRequest, reply: FastifyReply) => {
    return await reply.send({
      status: app.seriesCacher.getStatus(),
      queueLength: app.seriesCacher.queueLength,
      isDownloading: app.seriesCacher.isDownloading,
    });
  });

  // POST /follow/stop — stop all downloads
  app.post("/stop", async (_request: FastifyRequest, reply: FastifyReply) => {
    app.seriesCacher.stop();
    return await reply.send({ stopped: true });
  });

  // POST /follow/remove/:id — remove a series from queue
  app.post<{ Params: { id: string } }>("/:id/remove", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const removed = app.seriesCacher.removeSeries(Number(id));
    return await reply.send({ removed, seriesId: Number(id) });
  });
}
