// src/routes/player.ts
// Empty — Angular SPA is served by @fastify/static + setNotFoundHandler in app.ts.
// No explicit GET / needed — static plugin serves index.html for root automatically.

import type { FastifyInstance } from "fastify";

/**
 * Placeholder route plugin — Angular SPA serving is handled by static plugin.
 *
 * @param _app - Fastify instance (unused — static handles serving).
 */
export async function playerRoutes(_app: FastifyInstance): Promise<void> {
  // Angular SPA files served by @fastify/static
  // SPA fallback (404 → index.html) handled in app.ts setNotFoundHandler
}
