// src/app.ts
// App factory — builds and configures Fastify WITHOUT listening.
// Like @SpringBootTest(webEnvironment = MOCK) — creates the context, doesn't bind a port.
//
// server.ts calls buildApp() + listen() for production.
// Tests call buildApp() + inject() for in-process HTTP testing (MockMvc pattern).

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getLoggerConfig } from "./logger.js";
import { registerErrorHandler } from "./error-handler.js";
import { registerAuthGuard } from "./auth-guard.js";
import { createMemoryCache, createRedisCache, createTieredCache } from "./cache/index.js";
import type { CacheStore } from "./cache/index.js";
import { createDiskCache } from "./cache/disk-cache.js";
import { createWatchedCleaner } from "./cache/watched-cleaner.js";
import { playerRoutes } from "./routes/player.js";
import { authRoutes } from "./routes/auth.js";
import { proxyRoutes } from "./routes/proxy.js";
import { healthRoutes } from "./routes/health.js";
import { streamRoutes } from "./routes/stream.js";
import { libraryRoutes } from "./routes/library.js";
import { apiRoutes } from "./routes/api.js";
import { transcodeRoutes } from "./routes/transcode.js";
import { xtreamRoutes } from "./routes/xtream.js";
import { watchRoutes } from "./routes/watch.js";
import { tmdbRoutes } from "./routes/tmdb.js";
import { aiRoutes } from "./routes/ai.js";
import { liveHlsRoutes } from "./routes/live-hls.js";
import { favoritesRoutes } from "./routes/favorites.js";
import { followRoutes } from "./routes/follow.js";
import { createSeriesCacher } from "./cache/series-cacher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Augment Fastify types so app.cache is recognized
// Like declaring a @Bean return type in Spring's ApplicationContext
declare module "fastify" {
  interface FastifyInstance {
    cache: CacheStore;
  }
}

/**
 * Builds a fully configured Fastify instance without starting the server.
 * Use for production (+ listen) and for tests (+ inject).
 *
 * @returns Configured Fastify app ready to listen or inject.
 */
export async function buildApp() {
  const app = Fastify({ logger: getLoggerConfig() });

  // Plugins
  await app.register(fastifyCookie);
  await app.register(fastifyFormbody);
  await app.register(fastifyStatic, {
    root: path.join(__dirname, "..", "frontend", "dist", "frontend", "browser"),
    wildcard: false, // We handle SPA fallback manually below
  });
  await app.register(rateLimit, { max: 100, timeWindow: 60_000 });
  await app.register(cors, {
    origin: process.env.NODE_ENV === "production" ? ["https://rarebreed.app"] : true,
    methods: ["GET", "POST"],
    credentials: true,
  });

  // Security headers — like Spring Security http.headers()
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https://image.tmdb.org", "http:", "https:"],
        mediaSrc: ["'self'", "blob:", "http:", "https:"],  // HLS.js uses blob: URLs for video
        connectSrc: ["'self'", "blob:"],  // HLS.js fetch + blob
        workerSrc: ["'self'", "blob:"],   // HLS.js web worker
      },
    },
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "RareBreed Player API",
        version: "0.1.0",
        description: "IPTV streaming player API",
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  // Error handler before routes
  registerErrorHandler(app);

  // Cache — L1 (memory) + L2 (Redis) tiered
  // Like @Bean CacheManager with CompositeCacheManager(caffeine, redis)
  const cache = createTieredCache({
    l1: createMemoryCache({ max: 50, ttlMs: 5 * 60_000 }),   // 5 min local
    l2: createRedisCache({ ttlMs: 10 * 60_000 }),            // 10 min shared
  });

  // Decorate app with cache — like registering a @Bean in Spring context
  // Routes access it via: app.cache.get(key)
  app.decorate("cache", cache);

  // Disk cache for video streams (bounded by available disk - 10%)
  // Like Ehcache disk tier or Nginx proxy_cache
  const diskCache = await createDiskCache({ minFreeRatio: 0.10 });
  app.decorate("diskCache", diskCache);

  // Watched-episode auto-cleaner — deletes cached episodes X days after completion
  // Like @Scheduled + CacheEvictionPolicy in Spring
  const watchedCleaner = createWatchedCleaner(diskCache);
  app.decorate("watchedCleaner", watchedCleaner);
  watchedCleaner.start();

  // Stop cleaner on shutdown
  app.addHook("onClose", async () => {
    watchedCleaner.stop();
  });

  // Series cacher — background downloads episodes of followed series
  // Like Netflix Smart Downloads — pre-fetches next episodes automatically
  const seriesCacher = createSeriesCacher(app);
  app.decorate("seriesCacher", seriesCacher);

  // Stop cacher on shutdown
  app.addHook("onClose", async () => {
    seriesCacher.stop();
  });

  // Auth guard — like Spring Security filter chain
  // Must be AFTER cookie plugin (needs cookies parsed) and BEFORE routes
  registerAuthGuard(app);

  // Routes
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(proxyRoutes, { prefix: "/proxy" });
  await app.register(streamRoutes, { prefix: "/stream" });
  await app.register(libraryRoutes, { prefix: "/library" });
  await app.register(apiRoutes, { prefix: "/api" });
  await app.register(transcodeRoutes, { prefix: "/transcode" });
  await app.register(xtreamRoutes, { prefix: "/xtream" });
  await app.register(watchRoutes, { prefix: "/watch" });
  await app.register(tmdbRoutes, { prefix: "/api/tmdb" });
  await app.register(aiRoutes, { prefix: "/ai" });
  await app.register(liveHlsRoutes, { prefix: "/live-hls" });
  await app.register(favoritesRoutes, { prefix: "/favorites" });
  await app.register(followRoutes, { prefix: "/follow" });
  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(playerRoutes);

  // SPA fallback: non-API 404s serve index.html (Angular handles routing)
  app.setNotFoundHandler((request, reply) => {
    const accept = request.headers.accept ?? "";
    if (request.method === "GET" && accept.includes("text/html")) {
      return reply.sendFile("index.html");
    }
    return reply.status(404).send({
      error: `Route ${request.method} ${request.url} not found`,
      statusCode: 404,
    });
  });

  return app;
}
