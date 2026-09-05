// src/routes/tmdb.ts
// TMDB API proxy — searches for movies/series ratings and metadata.
// Keeps the API key server-side (not exposed to browser).
// Free tier: 40 requests/10 seconds.
//
// Get your API key: https://www.themoviedb.org/settings/api

import type { FastifyInstance } from "fastify";

const TMDB_BASE = "https://api.themoviedb.org/3";

/**
 * Registers TMDB search proxy route.
 * Frontend calls /api/tmdb/search?query=Friends&type=tv
 *
 * @param app - Fastify instance.
 */
export async function tmdbRoutes(app: FastifyInstance): Promise<void> {
  const apiKey = process.env.TMDB_API_KEY ?? "";

  // GET /tmdb/search?query=<name>&type=movie|tv
  app.get<{ Querystring: { query: string; type?: string } }>(
    "/search",
    async (request, reply) => {
      const { query, type } = request.query as { query?: string; type?: string };

      if (!query) {
        return await reply.status(400).send({ error: "Missing query" });
      }

      if (!apiKey) {
        return await reply.send({ results: [], total_results: 0 });
      }

      const searchType = type === "tv" ? "tv" : "movie";
      const url = `${TMDB_BASE}/search/${searchType}?query=${encodeURIComponent(query)}&language=en-US&page=1`;

      try {
        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(5_000),
        });

        if (!response.ok) {
          return await reply.send({ results: [], total_results: 0 });
        }

        const data = await response.json();
        return await reply.send(data);
      } catch {
        return await reply.send({ results: [], total_results: 0 });
      }
    },
  );

  // ─── Recommendations ─── //

  interface TmdbResult {
    id: number;
    title?: string;
    name?: string;
    overview: string;
    vote_average: number;
    poster_path: string | null;
    media_type?: string;
  }

  interface RecommendationItem {
    id: number;
    title: string;
    overview: string;
    rating: number;
    poster: string | null;
    type: "movie" | "tv";
    reason: string;
  }

  /** Helper: search TMDB for a title, return first match ID + type */
  async function findTmdbId(title: string, headers: Record<string, string>): Promise<{ id: number; type: "movie" | "tv"; name: string } | undefined> {
    // Try TV first (most IPTV content is shows), then movie
    for (const mediaType of ["tv", "movie"] as const) {
      try {
        const url = `${TMDB_BASE}/search/${mediaType}?query=${encodeURIComponent(title)}&language=en-US&page=1`;
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
        if (!res.ok) continue;
        const data = await res.json() as { results: TmdbResult[] };
        const first = data.results[0];
        if (first) {
          return { id: first.id, type: mediaType, name: first.name ?? first.title ?? title };
        }
      } catch { /* skip */ }
    }
    return undefined;
  }

  /** Helper: get recommendations for a TMDB ID */
  async function getRecommendations(id: number, type: "movie" | "tv", headers: Record<string, string>): Promise<TmdbResult[]> {
    try {
      const url = `${TMDB_BASE}/${type}/${String(id)}/recommendations?language=en-US&page=1`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return [];
      const data = await res.json() as { results: TmdbResult[] };
      return data.results;
    } catch {
      return [];
    }
  }

  // POST /tmdb/recommendations
  // Body: { titles: string[] } — list of show/movie names from watch history
  // Returns: ranked recommendations with "because you watched X" reason
  app.post<{ Body: { titles: string[] } }>(
    "/recommendations",
    async (request, reply) => {
      const { titles } = request.body;

      if (!titles || !Array.isArray(titles) || titles.length === 0) {
        return await reply.status(400).send({ error: "Missing titles array" });
      }

      if (!apiKey) {
        return await reply.send({ recommendations: [] });
      }

      const headers = {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      };

      // Limit to 5 source titles to stay within TMDB rate limits
      const sourceTitles = titles.slice(0, 5);
      const seen = new Set<number>();
      const recommendations: RecommendationItem[] = [];

      for (const title of sourceTitles) {
        // Clean the title (remove "S01E02" style suffixes, channel prefixes)
        const cleanTitle = title
          .replace(/\s*S\d{1,2}E\d{1,3}.*/i, "")
          .replace(/\s*-\s*Season\s*\d+.*/i, "")
          .replace(/^[A-Z]{2}\s*\|\s*/i, "")
          .trim();

        if (cleanTitle.length < 2) continue;

        const found = await findTmdbId(cleanTitle, headers);
        if (!found) continue;

        const recs = await getRecommendations(found.id, found.type, headers);

        for (const rec of recs.slice(0, 5)) {
          if (seen.has(rec.id)) continue;
          seen.add(rec.id);

          recommendations.push({
            id: rec.id,
            title: rec.name ?? rec.title ?? "Unknown",
            overview: rec.overview,
            rating: rec.vote_average,
            poster: rec.poster_path ? `https://image.tmdb.org/t/p/w200${rec.poster_path}` : null,
            type: found.type,
            reason: `Because you watched ${found.name}`,
          });
        }
      }

      // Sort by rating (highest first)
      recommendations.sort((a, b) => b.rating - a.rating);

      return await reply.send({ recommendations: recommendations.slice(0, 20) });
    },
  );
}
