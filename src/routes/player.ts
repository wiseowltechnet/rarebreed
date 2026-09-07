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
  app.get<{ Querystring: { session?: string; title?: string; type?: string } }>(
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
            type: {
              type: "string",
              enum: ["transcode", "live"],
              description:
                "Session kind -- transcode for VOD/series (default), live for a live-hls session. These are two different endpoints on this same server (/transcode/:id/playlist.m3u8 vs /live-hls/:id/live.m3u8), not interchangeable IDs.",
            },
          },
          required: ["session"],
        },
      },
    },
    async (request, reply) => {
      const { session, title, type } = request.query;
      if (!session) {
        return await reply.status(400).send({ error: "Missing session" });
      }
      const safeSession = encodeURIComponent(session);
      const safeTitle = escapeHtml(title ?? "Wise Owl");
      // Confirmed live: a live-hls session ID silently 404d against the
      // transcode path ("hls.js error: networkError / manifestLoadError"),
      // since the two session kinds are served from entirely different
      // routes with no overlap in ID namespace -- there is no way to tell
      // them apart from the ID alone, so the caller must say which kind.
      const manifestPath =
        type === "live"
          ? `/live-hls/${safeSession}/live.m3u8`
          : `/transcode/${safeSession}/playlist.m3u8`;

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#000;height:100%}video{width:100vw;height:100vh;object-fit:contain}
#label{position:fixed;top:16px;left:16px;color:#fff;font-family:sans-serif;font-size:28px;text-shadow:0 0 6px #000;z-index:2}
#status{position:fixed;bottom:16px;left:16px;color:#0f0;font-family:monospace;font-size:20px;text-shadow:0 0 6px #000;z-index:2;max-width:90vw}</style>
</head><body>
<div id="label">${safeTitle}</div>
<div id="status">loading player…</div>
<video id="v" autoplay controls muted></video>
<script>
  function setStatus(msg) { document.getElementById("status").textContent = msg; }
  window.onerror = function(msg, src, line) { setStatus("JS error: " + msg + " (" + src + ":" + line + ")"); };
</script>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js" onload="setStatus('hls.js loaded')" onerror="setStatus('hls.js FAILED to load from CDN')"></script>
<script>
  var video = document.getElementById("v");
  var src = "${manifestPath}";
  video.addEventListener("error", function() {
    var e = video.error;
    setStatus("video error: code " + (e ? e.code : "?"));
  });
  video.addEventListener("playing", function() { setStatus("playing"); });
  if (typeof Hls === "undefined") {
    setStatus("Hls is undefined -- script did not load");
  } else if (Hls.isSupported()) {
    setStatus("attaching hls.js to " + src);
    var hls = new Hls();
    hls.on(Hls.Events.ERROR, function(event, data) {
      setStatus("hls.js error: " + data.type + " / " + data.details + (data.fatal ? " (fatal)" : ""));
    });
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, function() {
      setStatus("manifest parsed, playing...");
      video.muted = true;
      var p = video.play();
      if (p && p.catch) p.catch(function(err) { setStatus("play() rejected: " + err); });
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    setStatus("using native HLS");
    video.src = src;
    video.addEventListener("loadedmetadata", function() {
      video.muted = true;
      var p = video.play();
      if (p && p.catch) p.catch(function(err) { setStatus("play() rejected: " + err); });
    });
  } else {
    setStatus("HLS not supported by this browser");
  }
</script>
</body></html>`;

      return await reply.type("text/html").send(html);
    },
  );
}
