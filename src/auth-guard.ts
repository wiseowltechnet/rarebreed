// src/auth-guard.ts
// Replaces: Spring Security SecurityFilterChain
// Protects API routes — returns 401 for unauthenticated API requests.
// Angular handles page-level auth redirects client-side via its own route guard.

import type { FastifyInstance } from "fastify";

// Routes that don't require authentication — like .permitAll()
const PUBLIC_PATHS = [
  "/auth/",
  "/health",
  "/docs",
  "/stream",     // internal: ffmpeg/mpv access cached streams
  "/transcode/", // internal: HLS.js fetches segments
  "/live-hls/",  // internal: HLS.js fetches live segments
];

// Static file extensions that should pass through without auth
const STATIC_EXTENSIONS = [".js", ".css", ".ico", ".html", ".map", ".woff", ".woff2", ".ttf"];

/**
 * Registers a request-level auth guard that protects API routes.
 * Static files and public paths are exempt. Angular handles page auth.
 *
 * @param app - Fastify instance to attach the guard to.
 */
export function registerAuthGuard(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    const url = request.url;

    // Static files pass through (Angular assets: .js, .css, etc.)
    if (STATIC_EXTENSIONS.some((ext) => url.includes(ext))) {
      return;
    }

    // Public paths pass through
    if (PUBLIC_PATHS.some((p) => url.startsWith(p))) {
      return;
    }

    // Root / and Angular routes (no dot in path) pass through — Angular handles auth
    if (url === "/" || (!url.includes(".") && !url.startsWith("/api") && !url.startsWith("/proxy"))) {
      return;
    }

    // API routes require auth cookie
    const authCookie = request.cookies.auth;
    if (authCookie !== "true") {
      // Return 401 for API calls — Angular intercepts and redirects to login
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });
}
