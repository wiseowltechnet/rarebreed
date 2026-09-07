// src/routes/player.ts
// Empty — Angular SPA is served by @fastify/static + setNotFoundHandler in app.ts.
// No explicit GET / needed — static plugin serves index.html for root automatically.
//
// The one exception is /demo/player below: a minimal same-origin HLS.js
// player used by the mesh's show-me integration (Shield TV display). It has
// to be served from this app's own origin rather than as a static file or a
// show-me dashboard payload, because HLS.js fetches the manifest/segments
// with real fetch() calls that are subject to CORS -- a data: URL or
// different-origin page would be blocked by the production CORS allowlist
// (see app.ts's cors registration, which only permits https://rarebreed.app).
// Same-origin sidesteps that entirely.

import type { FastifyInstance } from "fastify";

/**
 * Escapes a string for safe interpolation into HTML text content or a
 * double-quoted HTML attribute.
 *
 * @param value - Raw string to escape.
 * @returns HTML-safe string.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Registers player-related routes.
 *
 * @param app - Fastify instance.
 */
export async function playerRoutes(app: FastifyInstance): Promise<void> {
  // Angular SPA files served by @fastify/static
  // SPA fallback (404 → index.html) handled in app.ts setNotFoundHandler

  // GET /demo/player?session=<transcode id>&title=<display title>
  // Minimal same-origin HLS.js player for an existing /transcode/:id session.
  // Not part of the Angular app -- a small standalone demo page for showing
  // a pulled stream on the Shield via show-me's show_url tool.
  app.get<{ Querystring: { session?: string; title?: string } }>(
    "/demo/player",
    {
      schema: {
        description:
          "Minimal same-origin HLS.js player for a transcode session, for on-screen display demos",
        tags: ["demo"],
        querystring: {
          type: "object",
          properties: {
            session: { type: "string" },
            title: { type: "string" },
          },
          required: ["session"],
        },
      },
    },
    async (request, reply) => {
      const { session, title } = request.query;
      if (!session) {
        return await reply.status(400).send({ error: "Missing session" });
      }
      const safeSession = encodeURIComponent(session);
      const safeTitle = escapeHtml(title ?? "Wise Owl");

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#000;height:100%}video{width:100vw;height:100vh;object-fit:contain}
#label{position:fixed;top:16px;left:16px;color:#fff;font-family:sans-serif;font-size:28px;text-shadow:0 0 6px #000;z-index:2}</style>
</head><body>
<div id="label">${safeTitle}</div>
<video id="v" autoplay controls muted></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"></script>
<script>
  var video = document.getElementById("v");
  var src = "/transcode/${safeSession}/playlist.m3u8";
  if (Hls.isSupported()) {
    var hls = new Hls();
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, function() { video.muted = true; video.play(); });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = src;
    video.addEventListener("loadedmetadata", function() { video.muted = true; video.play(); });
  }
</script>
</body></html>`;

      return await reply.type("text/html").send(html);
    },
  );
}
