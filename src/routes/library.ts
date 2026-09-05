// src/routes/library.ts
// Library API endpoint — Angular handles the UI, this just provides data.

import type { FastifyInstance } from "fastify";

/**
 * Registers library API route for saved videos.
 *
 * @param app - Fastify instance with diskCache decorated.
 */
export async function libraryRoutes(app: FastifyInstance): Promise<void> {
  // GET /library — list all saved videos (used by Angular LibraryService)
  app.get("/", async (_request, reply) => {
    const saved = await app.diskCache.getSaved();
    return await reply.send(saved);
  });
}
