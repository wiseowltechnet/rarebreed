// src/routes/proxy.ts
// Replaces: ProxyController.java
// Now with: Zod validation, tiered caching, and timeout.
// Like: @Cacheable("playlists") + @Valid + HttpClient.timeout()

import type { FastifyInstance } from "fastify";
import { ProxyQuerySchema } from "../schemas.js";

/**
 * Registers the proxy route that fetches remote URLs server-side (avoids CORS for M3U playlists).
 * Uses tiered cache (L1 memory + L2 Redis) to avoid repeated upstream fetches.
 *
 * @param app - Fastify instance to register the /proxy route on.
 */
export async function proxyRoutes(app: FastifyInstance): Promise<void> {
  // GET /proxy?url=<encoded-url>
  app.get(
    "/",
    {
      config: { rateLimit: { max: 20, timeWindow: 60_000 } },
      schema: {
        description: "Proxy fetch a remote URL (cached, rate-limited)",
        tags: ["proxy"],
        querystring: {
          type: "object",
          properties: { url: { type: "string", format: "uri" } },
          required: ["url"],
        },
        response: {
          200: { type: "string", description: "Remote content (possibly cached)" },
          400: { type: "object", properties: { error: { type: "string" } } },
          502: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const result = ProxyQuerySchema.safeParse(request.query);

      if (!result.success) {
        return reply.status(400).send({
          error: "Invalid query parameters",
          details: result.error.issues,
        });
      }

      const { url } = result.data;

      // 1. Check cache — like @Cacheable(key = "#url")
      // Checks L1 (memory, ~0.001ms) then L2 (Redis, ~1ms)
      const cached = await app.cache.get(url);
      if (cached !== undefined) {
        request.log.info({ url, cache: "hit" }, "Serving from cache");
        return await reply
          .header("X-Cache", "HIT")
          .type("text/plain")
          .send(cached);
      }

      // 2. Cache miss — fetch from origin
      request.log.info({ url, cache: "miss" }, "Fetching from upstream");

      try {
        const response = await fetch(url, {
          headers: { "User-Agent": "RareBreed/1.0" },
          signal: AbortSignal.timeout(60_000),
        });

        const body = await response.text();

        // 3. Store in cache for next request — like @CachePut
        // Writes to L1 + L2 simultaneously (write-through)
        await app.cache.set(url, body);

        return await reply
          .header("X-Cache", "MISS")
          .type("text/plain")
          .send(body);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown fetch error";
        return await reply.status(502).send({ error: message });
      }
    },
  );
}
