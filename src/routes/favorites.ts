// src/routes/favorites.ts
// Favorites CRUD API — star live channels, series, and movies.
// Persisted server-side in data/favorites.json (survives browser clear).
//
// Like: Spring @RestController + JPA Repository for a "favorites" entity.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/** A single favorite entry */
export interface Favorite {
  /** Unique ID (stream URL or series ID) */
  readonly id: string;
  /** Display name */
  readonly name: string;
  /** Content type */
  readonly type: "live" | "movie" | "series";
  /** Stream URL (for live/movie) */
  readonly url?: string | undefined;
  /** Poster/icon URL */
  readonly icon?: string | undefined;
  /** Category name */
  readonly category?: string | undefined;
  /** Series ID (for series type) */
  readonly seriesId?: number | undefined;
  /** When it was favorited (epoch ms) */
  readonly addedAt: number;
}

const DATA_PATH = path.join(process.cwd(), "data", "favorites.json");

/** Narrows an unknown value to a string id, without risking String()
 * silently stringifying an unexpected object/array to `[object Object]`. */
function toIdString(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return undefined;
}

/** Load favorites from disk */
async function loadFavorites(): Promise<Favorite[]> {
  if (!existsSync(DATA_PATH)) return [];
  try {
    const raw = await fs.readFile(DATA_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Normalize every entry's id to a real string -- a numeric id could
    // reach disk before this fix (an unvalidated `request.body as
    // Partial<Favorite>` cast let a JSON number through as if it were the
    // declared `string` type, e.g. a raw xtream VOD/series id), which then
    // silently failed every string comparison against a URL param
    // (`===`/`!==` on mismatched types is never true in JS). Normalizing
    // once here means every consumer downstream can trust `Favorite.id` is
    // honestly a string with no special-casing needed at each call site,
    // and self-heals any already-corrupted data on disk transparently on
    // the next load.
    return (parsed as Record<string, unknown>[]).map((entry) => ({
      ...(entry as unknown as Favorite),
      id: String(entry.id),
    }));
  } catch {
    return [];
  }
}

/** Save favorites to disk */
async function saveFavorites(favorites: Favorite[]): Promise<void> {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify(favorites, null, 2));
}

/**
 * Registers favorites routes:
 *   GET    /favorites          — list all favorites (optionally filter by type)
 *   POST   /favorites          — add a favorite
 *   DELETE /favorites/:id      — remove a favorite
 *   GET    /favorites/check/:id — check if an item is favorited
 */
export async function favoritesRoutes(app: FastifyInstance): Promise<void> {
  // GET /favorites?type=live|movie|series
  app.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
    const { type } = request.query as { type?: string };
    let favorites = await loadFavorites();

    if (type && ["live", "movie", "series"].includes(type)) {
      favorites = favorites.filter((f) => f.type === type);
    }

    return reply.send(favorites);
  });

  // POST /favorites — add a new favorite
  app.post("/", async (request: FastifyRequest, reply: FastifyReply) => {
    const rawBody = request.body as Record<string, unknown>;
    const body = request.body as Partial<Favorite>;

    if (!body.name || !body.type) {
      return reply.status(400).send({ error: "Missing name or type" });
    }

    // Read id/url as unknown rather than through the Partial<Favorite>
    // cast above -- that cast only asserts a string, it never validates
    // one. A caller sending a numeric id (a raw xtream VOD/series id,
    // e.g. 15712) is real untrusted input the type system has not
    // actually checked, and coercing it here is what keeps every id on
    // disk (and therefore every future string comparison against a URL
    // param) honestly a string from the moment it is first stored.
    const id =
      toIdString(rawBody.id) ?? toIdString(rawBody.url) ?? `${body.type}-${String(Date.now())}`;

    const favorites = await loadFavorites();

    // Idempotent — don't duplicate
    if (favorites.some((f) => f.id === id)) {
      return reply.send({ added: false, message: "Already favorited" });
    }

    const entry: Favorite = {
      id,
      name: body.name,
      type: body.type,
      url: body.url,
      icon: body.icon,
      category: body.category,
      seriesId: body.seriesId,
      addedAt: Date.now(),
    };

    favorites.unshift(entry); // newest first
    await saveFavorites(favorites);

    return reply.status(201).send({ added: true, favorite: entry });
  });

  // DELETE /favorites/:id — remove a favorite
  app.delete("/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const favorites = await loadFavorites();
    const filtered = favorites.filter((f) => f.id !== decodeURIComponent(id));

    if (filtered.length === favorites.length) {
      return reply.status(404).send({ error: "Favorite not found" });
    }

    await saveFavorites(filtered);
    return reply.send({ removed: true });
  });

  // GET /favorites/check/:id — quick check if item is favorited
  app.get("/check/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const favorites = await loadFavorites();
    const found = favorites.some((f) => f.id === decodeURIComponent(id));
    return reply.send({ favorited: found });
  });
}
