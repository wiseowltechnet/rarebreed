// src/routes/stream.ts
// Video stream proxy with disk caching.
// Cache HIT: stream from local disk file (~instant).
// Cache MISS: fetch upstream → tee bytes to client + disk simultaneously.
//
// Like: Nginx proxy_cache, or Spring StreamingResponseBody + TeeInputStream.

import type { FastifyInstance, FastifyReply } from "fastify";
import { PassThrough, Readable } from "node:stream";
import type { DiskCache } from "../cache/disk-cache.js";

// Augment Fastify types for diskCache
declare module "fastify" {
  interface FastifyInstance {
    diskCache: DiskCache;
  }
}

/**
 * Registers the /stream route that proxies and caches video streams.
 *
 * @param app - Fastify instance with diskCache decorated.
 */
export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/",
    {
      schema: {
        description: "Proxy and cache a video stream URL",
        tags: ["stream"],
      },
    },
    async (request, reply): Promise<FastifyReply> => {
      const url = (request.query as { url?: string }).url;

      if (!url) {
        return reply.status(400).send({ error: "Missing url parameter" });
      }

      // Detect live streams — don't cache (infinite, caching partial snippets is useless)
      const isLive = url.includes("/live/");

      // 1. Check disk cache (skip for live streams)
      if (!isLive) {
        const cached = await app.diskCache.get(url);
        if (cached) {
          request.log.info({ url, cache: "disk-hit" }, "Serving from disk cache");
          return reply
            .header("X-Cache", "HIT")
            .header("Content-Type", cached.meta.contentType)
            .send(cached.stream);
        }
      }

      // 2. Fetch from upstream
      request.log.info({ url, cache: isLive ? "live-passthrough" : "disk-miss" }, "Fetching from upstream");

      try {
        // For live streams: no timeout (infinite stream).
        // For VOD: 60s timeout to catch hung connections.
        const fetchOptions: RequestInit = {
          headers: { "User-Agent": "RareBreed/1.0" },
        };
        if (!isLive) {
          fetchOptions.signal = AbortSignal.timeout(60_000);
        }

        const upstream = await fetch(url, fetchOptions);

        // Some IPTV servers return non-200 but still have valid content-type
        // (e.g. the IPTV provider returns 400 with content-type: video/x-matroska)
        // Only reject if truly no content
        if (!upstream.ok && !upstream.headers.get("content-type")?.includes("video")) {
          return await reply.status(upstream.status).send({
            error: `Upstream returned ${String(upstream.status)}`,
          });
        }

        if (!upstream.body) {
          return await reply.status(502).send({ error: "No response body" });
        }

        const contentType = upstream.headers.get("content-type") ?? "video/mp2t";

        // Convert Web ReadableStream → Node Readable
        const source = Readable.fromWeb(
          upstream.body as import("node:stream/web").ReadableStream,
        );

        // Destination: client (via PassThrough piped to reply)
        const toClient = new PassThrough();

        if (isLive) {
          // ─── LIVE: pipe directly, no disk write (infinite stream) ───
          // Auto-reconnect if upstream stalls (IPTV servers drop connections silently)
          let stallTimer: ReturnType<typeof setTimeout> | null = null;
          let currentSource = source;
          let reconnecting = false;

          const STALL_TIMEOUT = 30_000; // 30s without data = stalled

          function resetStallTimer(): void {
            if (stallTimer) clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
              if (reconnecting) return;
              reconnecting = true;
              request.log.warn({ url }, "Live stream stalled — reconnecting");
              currentSource.destroy();
              // Reconnect to upstream
              void reconnect();
            }, STALL_TIMEOUT);
          }

          async function reconnect(): Promise<void> {
            try {
              const streamUrl = url!;
              const retry = await fetch(streamUrl, {
                headers: { "User-Agent": "RareBreed/1.0" },
              });
              if (!retry.ok || !retry.body) {
                request.log.error({ url, status: retry.status }, "Reconnect failed");
                toClient.end();
                return;
              }
              const newSource = Readable.fromWeb(
                retry.body as import("node:stream/web").ReadableStream,
              );
              currentSource = newSource;
              reconnecting = false;
              request.log.info({ url }, "Live stream reconnected");

              newSource.on("data", (chunk: Buffer) => {
                toClient.write(chunk);
                resetStallTimer();
              });
              newSource.on("end", () => { toClient.end(); });
              newSource.on("error", (err) => {
                request.log.error({ err, url }, "Live stream error after reconnect");
                toClient.destroy(err);
              });
            } catch (err) {
              request.log.error({ err, url }, "Reconnect exception");
              toClient.end();
            }
          }

          source.on("data", (chunk: Buffer) => {
            toClient.write(chunk);
            resetStallTimer();
          });

          source.on("end", () => {
            if (stallTimer) clearTimeout(stallTimer);
            toClient.end();
          });

          source.on("error", (err) => {
            if (stallTimer) clearTimeout(stallTimer);
            request.log.error({ err, url }, "Live stream error");
            toClient.destroy(err);
          });

          request.raw.on("close", () => {
            if (stallTimer) clearTimeout(stallTimer);
            currentSource.destroy();
          });

          // Start stall detection
          resetStallTimer();
        } else {
          // ─── VOD: tee to disk cache while streaming to client ───
          const { stream: toFile } = app.diskCache.createWriteStream(url);

          source.on("data", (chunk: Buffer) => {
            toClient.write(chunk);
            toFile.write(chunk);
          });

          source.on("end", () => {
            toClient.end();
            toFile.end();
            void app.diskCache.commit(url, contentType).then(() => {
              void app.diskCache.evict();
            });
          });

          source.on("error", (err) => {
            request.log.error({ err, url }, "Upstream stream error");
            toClient.destroy(err);
            toFile.end();
            void app.diskCache.commit(url, contentType);
          });

          request.raw.on("close", () => {
            source.destroy();
            toFile.end();
            void app.diskCache.commit(url, contentType).then(() => {
              void app.diskCache.evict();
            });
          });
        }

        // Send client stream as response (starts streaming immediately)
        return await reply
          .header("X-Cache", isLive ? "LIVE" : "MISS")
          .header("Content-Type", contentType)
          .send(toClient);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Stream error";
        return await reply.status(502).send({ error: message });
      }
    },
  );
}
