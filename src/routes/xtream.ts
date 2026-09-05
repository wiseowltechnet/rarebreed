// src/routes/xtream.ts
// Xtream API proxy — provides tree-structured category/channel data.
// Replaces flat M3U parsing with proper API calls to the IPTV provider.
//
// the IPTV provider (and most IPTV providers) support the "Xtream Codes" API:
//   /player_api.php?username=X&password=Y&action=get_live_categories
//   /player_api.php?username=X&password=Y&action=get_live_streams&category_id=Z
//
// This gives us a clean tree: ContentType → Category → Channels

import type { FastifyInstance } from "fastify";
import { loadConfig } from "../config.js";

/** Content types available in Xtream API */
type ContentType = "live" | "vod" | "series";

interface XtreamCategory {
  readonly category_id: string;
  readonly category_name: string;
  readonly parent_id: number;
}

interface XtreamChannel {
  readonly num: number;
  readonly name: string;
  readonly stream_id: number;
  readonly stream_icon: string;
  readonly category_id: string;
  readonly container_extension?: string;
}

interface XtreamSeriesInfo {
  readonly series_id: number;
  readonly name: string;
  readonly cover: string;
  readonly category_id: string;
}

// Cache categories in memory AND through the app's tiered cache (memory + Redis)
const categoryCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 10 * 60_000; // 10 minutes

/**
 * Registers Xtream API routes for tree-style category/channel navigation.
 *
 * @param app - Fastify instance.
 */
export async function xtreamRoutes(app: FastifyInstance): Promise<void> {
  const config = loadConfig();
  const { username, password, server } = config.iptv;

  /** Build Xtream API URL */
  function apiUrl(action: string, params: Record<string, string> = {}): string {
    const base = `${server}/player_api.php?username=${username}&password=${password}&action=${action}`;
    const extra = Object.entries(params).map(([k, v]) => `&${k}=${v}`).join("");
    return base + extra;
  }

  /** Fetch from Xtream API with tiered caching (memory → Redis → API) */
  async function fetchCached<T>(cacheKey: string, url: string): Promise<T> {
    // Check tiered cache first (L1 memory ~0ms, L2 Redis ~1ms)
    const cachedStr = await app.cache.get(`xtream:${cacheKey}`);
    if (cachedStr) {
      return JSON.parse(cachedStr) as T;
    }

    // Also check local Map (faster than parsing JSON on every hit)
    const localCached = categoryCache.get(cacheKey);
    if (localCached && Date.now() - localCached.timestamp < CACHE_TTL) {
      return localCached.data as T;
    }

    // Cache miss — fetch from Xtream API
    const response = await fetch(url, {
      headers: { "User-Agent": "RareBreed/1.0" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Xtream API returned ${String(response.status)}`);
    }

    const data = await response.json() as T;

    // Store in all cache layers
    categoryCache.set(cacheKey, { data, timestamp: Date.now() });
    // Store in tiered cache (memory + Redis) for other server instances
    await app.cache.set(`xtream:${cacheKey}`, JSON.stringify(data), CACHE_TTL);

    return data;
  }

  /** Build stream URL for a given content type and stream ID */
  function streamUrl(type: ContentType, streamId: number, extension?: string): string {
    switch (type) {
      case "live":
        return `${server}/live/${username}/${password}/${String(streamId)}.ts`;
      case "vod":
        return `${server}/movie/${username}/${password}/${String(streamId)}.${extension ?? "mp4"}`;
      case "series":
        return `${server}/series/${username}/${password}/${String(streamId)}.${extension ?? "mkv"}`;
    }
  }

  // GET /xtream/tree — returns the full navigation tree (types + categories)
  app.get("/tree", async (_request, reply) => {
    try {
      const [liveCategories, vodCategories, seriesCategories] = await Promise.all([
        fetchCached<XtreamCategory[]>("live-cats", apiUrl("get_live_categories")),
        fetchCached<XtreamCategory[]>("vod-cats", apiUrl("get_vod_categories")),
        fetchCached<XtreamCategory[]>("series-cats", apiUrl("get_series_categories")),
      ]);

      const tree = [
        {
          id: "live",
          name: "Live TV",
          icon: "📺",
          categories: liveCategories.map((c) => ({
            id: c.category_id,
            name: c.category_name,
          })),
        },
        {
          id: "vod",
          name: "Movies",
          icon: "🎬",
          categories: vodCategories.map((c) => ({
            id: c.category_id,
            name: c.category_name,
          })),
        },
        {
          id: "series",
          name: "Series",
          icon: "🎭",
          categories: seriesCategories.map((c) => ({
            id: c.category_id,
            name: c.category_name,
          })),
        },
      ];

      return await reply.send(tree);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch categories";
      return await reply.status(502).send({ error: message });
    }
  });

  // GET /xtream/channels?type=live&category_id=123
  // Returns channels for a specific category
  app.get<{ Querystring: { type: string; category_id: string } }>(
    "/channels",
    async (request, reply) => {
      const { type, category_id } = request.query as { type?: string; category_id?: string };

      if (!type || !category_id) {
        return await reply.status(400).send({ error: "Missing type or category_id" });
      }

      const contentType = type as ContentType;

      try {
        let channels: { name: string; url: string; icon?: string; id: number }[];

        if (contentType === "series") {
          // Series returns series info, not individual streams
          const data = await fetchCached<XtreamSeriesInfo[]>(
            `series-${category_id}`,
            apiUrl("get_series", { category_id }),
          );
          channels = data.map((s) => ({
            name: s.name,
            url: "", // series need another call for episodes
            icon: s.cover,
            id: s.series_id,
          }));
        } else {
          const action = contentType === "live" ? "get_live_streams" : "get_vod_streams";
          const data = await fetchCached<XtreamChannel[]>(
            `${contentType}-${category_id}`,
            apiUrl(action, { category_id }),
          );
          channels = data.map((ch) => ({
            name: ch.name,
            url: streamUrl(contentType, ch.stream_id, ch.container_extension),
            icon: ch.stream_icon,
            id: ch.stream_id,
          }));
        }

        return await reply.send(channels);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to fetch channels";
        return await reply.status(502).send({ error: message });
      }
    },
  );

  // GET /xtream/series/:id — returns episodes for a series
  app.get<{ Params: { id: string } }>("/series/:id", async (request, reply) => {
    const { id } = request.params;

    try {
      const data = await fetchCached<{ episodes: Record<string, XtreamChannel[]> }>(
        `series-info-${id}`,
        apiUrl("get_series_info", { series_id: id }),
      );

      const seasons = Object.entries(data.episodes ?? {}).map(([season, episodes]) => ({
        season: Number(season),
        episodes: (episodes as unknown as { id: number; title: string; container_extension: string }[]).map((ep) => ({
          name: ep.title,
          url: streamUrl("series", ep.id, ep.container_extension),
          id: ep.id,
        })),
      }));

      return await reply.send(seasons);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch series info";
      return await reply.status(502).send({ error: message });
    }
  });

  // GET /xtream/stream-url/:type/:id — resolve a stream ID to a playable upstream URL.
  // Used by the Roku channel for deep-linking (mesh roku_play_wiseowl sends the raw ID).
  app.get<{ Params: { type: string; id: string } }>(
    "/stream-url/:type/:id",
    async (request, reply) => {
      const { type, id } = request.params;
      const streamId = Number(id);

      if (Number.isNaN(streamId)) {
        return await reply.status(400).send({ error: "Invalid stream id" });
      }

      const contentType: ContentType =
        type === "vod" || type === "movie" ? "vod"
        : type === "series" ? "series"
        : "live";

      const url = streamUrl(contentType, streamId);
      return await reply.send({ url, type: contentType, id: streamId });
    },
  );

  // ---- Search (server-side) ------------------------------------------------
  // GET /xtream/search?q=WRAL&type=live,vod,series&limit=8
  // Searches channel/movie/series NAMES across the (cached) catalog and returns
  // a small ranked list. This exists so voice/remote clients do ONE request
  // instead of fanning out to /tree + dozens of /channels calls (which trips
  // the API rate limiter). Results are cached per query for CACHE_TTL.

  /** Words that carry little identifying value on their own. */
  const SEARCH_STOP = new Set([
    "the", "a", "an", "of", "and", "tv", "channel", "hd", "us", "usa", "uk", "en",
  ]);

  function searchNorm(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  }
  function isWeak(t: string): boolean {
    return SEARCH_STOP.has(t) || /^\d+$/.test(t) || t.length <= 2;
  }
  /**
   * Higher is better; 0 = no meaningful match.
   *
   * Rules tuned to avoid false positives on multi-word titles:
   *   - Exact name == query: 1000.
   *   - Whole query is a substring of the name (query has real signal): ~500.
   *   - Otherwise require most of the query's STRONG tokens to appear as WHOLE
   *     WORDS in the candidate. Loose acronym-substring matching is only used
   *     for single-strong-token queries (channel calls like "WRAL"), never for
   *     multi-word titles, so "day" can't match "Daytona".
   *   - A match must cover >= 60% of the query's strong tokens to score at all.
   */
  function searchScore(query: string, candidate: string): number {
    const q = searchNorm(query);
    const c = searchNorm(candidate);
    if (q.length === 0) return 0;
    if (c === q) return 1000;

    const qTokens = q.split(" ").filter(Boolean);
    const strong = qTokens.filter((t) => !isWeak(t));
    if (strong.length === 0) return 0; // query is all weak words -> no signal

    if (c.includes(q)) return 500 + q.length;

    const cTokens = new Set(c.split(" "));
    const cJoined = c.replace(/ /g, "");
    const allowLooseSubstring = strong.length === 1; // only for single-word channel calls

    let hits = 0;
    for (const t of strong) {
      if (cTokens.has(t)) hits++;
      else if (allowLooseSubstring && t.length >= 3 && cJoined.includes(t)) hits++;
    }
    if (hits === 0) return 0;

    const coverage = hits / strong.length;
    if (coverage < 0.6) return 0;

    return hits * 100 + coverage * 200;
  }

  interface SearchHit {
    readonly id: number;
    readonly name: string;
    readonly type: ContentType;
    readonly score: number;
  }

  app.get<{ Querystring: { q?: string; type?: string; limit?: string } }>(
    "/search",
    async (request, reply) => {
      const { q, type, limit } = request.query;
      if (!q || searchNorm(q).length === 0) {
        return await reply.status(400).send({ error: "Missing q" });
      }
      const maxResults = Math.min(Math.max(Number(limit ?? 8), 1), 25);
      const typesWanted: ContentType[] = (type ? type.split(",") : ["live", "vod", "series"])
        .map((t) => t.trim())
        .filter((t): t is ContentType => t === "live" || t === "vod" || t === "series");

      const cacheKey = `search:${searchNorm(q)}:${typesWanted.join(",")}:${String(maxResults)}`;
      const cached = await app.cache.get(`xtream:${cacheKey}`);
      if (cached) {
        return await reply.send(JSON.parse(cached) as SearchHit[]);
      }

      try {
        const catActions: Record<ContentType, string> = {
          live: "get_live_categories",
          vod: "get_vod_categories",
          series: "get_series_categories",
        };
        const streamActions: Record<ContentType, string> = {
          live: "get_live_streams",
          vod: "get_vod_streams",
          series: "get_series",
        };

        const hits: SearchHit[] = [];
        const isSingleWord = searchNorm(q).split(" ").filter((t) => !isWeak(t)).length <= 1;

        for (const t of typesWanted) {
          const cats = await fetchCached<XtreamCategory[]>(`${t}-cats`, apiUrl(catActions[t]));
          for (const cat of cats) {
            const items = await fetchCached<(XtreamChannel | XtreamSeriesInfo)[]>(
              t === "series" ? `series-${cat.category_id}` : `${t}-${cat.category_id}`,
              apiUrl(streamActions[t], { category_id: cat.category_id }),
            );
            for (const it of items) {
              const name = it.name;
              const id = t === "series"
                ? (it as XtreamSeriesInfo).series_id
                : (it as XtreamChannel).stream_id;
              const s = searchScore(q, name);
              if (s > 0) hits.push({ id, name, type: t, score: s });
            }
          }
          if (isSingleWord && t === "live") {
            const strong = hits.filter((h) => h.type === "live" && h.score >= 500);
            if (strong.length > 0) break;
          }
        }

        hits.sort((a, b) => b.score - a.score);
        const top = hits.slice(0, maxResults);
        await app.cache.set(`xtream:${cacheKey}`, JSON.stringify(top), CACHE_TTL);
        return await reply.send(top);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Search failed";
        return await reply.status(502).send({ error: message });
      }
    },
  );
}
