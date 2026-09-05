// src/routes/transcode.ts
// Server-side transcoding: converts MKV/AVI/any format to HLS for browser playback.
// Like: Plex/Jellyfin's "transcode on the fly" feature.
//
// Flow:
//   1. GET /transcode?url=<mkv-url>  → starts ffmpeg, returns session ID + playlist URL
//   2. GET /transcode/:id/playlist.m3u8  → serves the HLS manifest (updates as ffmpeg produces segments)
//   3. GET /transcode/:id/:segment     → serves individual .ts segments
//
// ffmpeg produces segments progressively — video starts playing within 2-5 seconds
// even though the full file hasn't been transcoded yet.

import type { FastifyInstance } from "fastify";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import path from "node:path";

// Active transcode sessions
interface TranscodeSession {
  id: string;
  url: string;
  process: ChildProcess;
  dir: string;
  startedAt: number;
}

const sessions = new Map<string, TranscodeSession>();
const TRANSCODE_DIR = path.join(process.cwd(), "cache", "transcode");

/**
 * Registers transcode routes for on-the-fly MKV → HLS conversion.
 * Requires ffmpeg installed on the system.
 *
 * @param app - Fastify instance.
 */
export async function transcodeRoutes(app: FastifyInstance): Promise<void> {
  // Ensure transcode directory exists
  await fs.mkdir(TRANSCODE_DIR, { recursive: true });

  // POST /transcode — start a transcode session
  // Returns the session ID and playlist URL for HLS.js to load
  app.post<{ Body: { url: string } }>(
    "/",
    {
      schema: {
        description: "Start transcoding a video URL to HLS for browser playback",
        tags: ["transcode"],
        body: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      },
    },
    async (request, reply) => {
      const { url } = request.body;

      if (!url) {
        return await reply.status(400).send({ error: "Missing url" });
      }

      // Generate session ID from URL hash (deterministic — same URL = same session)
      const id = createHash("sha256").update(url).digest("hex").substring(0, 12);
      const sessionDir = path.join(TRANSCODE_DIR, id);

      // If session already exists and playlist is ready, just return it
      const playlistPath = path.join(sessionDir, "playlist.m3u8");
      if (existsSync(playlistPath)) {
        return await reply.send({
          id,
          playlist: `/transcode/${id}/playlist.m3u8`,
          status: "ready",
        });
      }

      // Create session directory
      await fs.mkdir(sessionDir, { recursive: true });

      // Spawn ffmpeg: input URL → HLS output
      // -re: read input at native frame rate (prevents overwhelming disk)
      // -c:v libx264 -preset ultrafast: fast transcoding (less CPU)
      // -c:a aac: universal audio codec
      // -f hls: output format
      // -hls_time 4: 4-second segments (quick start)
      // -hls_list_size 0: keep ALL segments in playlist (not live stream)
      // -hls_segment_filename: naming pattern for segments
      // Route through our stream proxy so the file is disk-cached
      // and ffmpeg reads from a reliable local source
      const port = (request.server.addresses()[0] as { port: number } | undefined)?.port ?? 3000;
      const inputUrl = `http://127.0.0.1:${String(port)}/stream?url=${encodeURIComponent(url)}`;

      const ffmpeg = spawn("ffmpeg", [
        "-i", inputUrl,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-c:a", "aac",
        "-ac", "2",
        "-f", "hls",
        "-hls_time", "4",
        "-hls_list_size", "0",
        "-hls_flags", "independent_segments",
        "-hls_segment_filename", path.join(sessionDir, "seg%03d.ts"),
        "-y",
        playlistPath,
      ], { stdio: ["ignore", "ignore", "pipe"] });

      // Log ffmpeg stderr for debugging
      let ffmpegLog = "";
      ffmpeg.stderr.on("data", (chunk: Buffer) => {
        ffmpegLog += chunk.toString();
      });

      ffmpeg.on("exit", (code) => {
        if (code !== 0 && code !== 255) {
          request.log.warn({ id, code, log: ffmpegLog.substring(0, 500) }, "ffmpeg exited with error");
        }
        sessions.delete(id);
      });

      ffmpeg.on("error", (err) => {
        request.log.error({ err, id }, "ffmpeg spawn error");
        sessions.delete(id);
      });

      // Track session
      sessions.set(id, { id, url, process: ffmpeg, dir: sessionDir, startedAt: Date.now() });

      // Wait briefly for ffmpeg to produce the initial playlist
      // (usually < 2 seconds for the first segment)
      await waitForFile(playlistPath, 10_000);

      return await reply.send({
        id,
        playlist: `/transcode/${id}/playlist.m3u8`,
        status: "transcoding",
      });
    },
  );

  // GET /transcode/:id/playlist.m3u8 — serve the HLS manifest
  // HLS.js polls this periodically to discover new segments
  app.get<{ Params: { id: string } }>("/:id/playlist.m3u8", async (request, reply) => {
    const { id } = request.params;
    const playlistPath = path.join(TRANSCODE_DIR, id, "playlist.m3u8");

    if (!existsSync(playlistPath)) {
      return await reply.status(404).send({ error: "Playlist not found" });
    }

    const content = await fs.readFile(playlistPath, "utf-8");
    return await reply
      .header("Content-Type", "application/vnd.apple.mpegurl")
      .header("Cache-Control", "no-cache")
      .send(content);
  });

  // GET /transcode/:id/:segment — serve a .ts segment file
  app.get<{ Params: { id: string; segment: string } }>("/:id/:segment", async (request, reply) => {
    const { id, segment } = request.params;
    const segmentPath = path.join(TRANSCODE_DIR, id, segment);

    if (!existsSync(segmentPath)) {
      return await reply.status(404).send({ error: "Segment not found" });
    }

    const stream = createReadStream(segmentPath);
    return await reply
      .header("Content-Type", "video/mp2t")
      .send(stream);
  });

  // GET /transcode/sessions — list active sessions (for debugging/health)
  app.get("/sessions", async (_request, reply) => {
    const active = [...sessions.values()].map((s) => ({
      id: s.id,
      url: s.url,
      startedAt: new Date(s.startedAt).toISOString(),
      runningSeconds: Math.floor((Date.now() - s.startedAt) / 1000),
    }));
    return await reply.send(active);
  });

  // DELETE /transcode/:id — stop a transcode session
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const session = sessions.get(id);

    if (session) {
      session.process.kill();
      sessions.delete(id);
    }

    return await reply.send({ success: true, id });
  });

  // Cleanup job — delete stale transcode sessions after 30 minutes of inactivity
  // Like: Plex's "terminate inactive transcode sessions" feature
  const CLEANUP_INTERVAL_MS = 5 * 60_000; // check every 5 minutes
  const MAX_SESSION_AGE_MS = 30 * 60_000; // 30 minutes max session lifetime

  const cleanupInterval = setInterval(() => {
    void (async () => {
      const now = Date.now();

      // 1. Kill old active sessions
      for (const [id, session] of sessions) {
        if (now - session.startedAt > MAX_SESSION_AGE_MS) {
          session.process.kill();
          sessions.delete(id);
          app.log.info({ id }, "Cleaned up stale transcode session");
        }
      }

      // 2. Delete orphaned transcode directories (no active session)
      try {
        const dirs = await fs.readdir(TRANSCODE_DIR);
        for (const dir of dirs) {
          if (sessions.has(dir)) continue; // still active — skip

          const dirPath = path.join(TRANSCODE_DIR, dir);
          const stat = await fs.stat(dirPath);

          // Delete if older than max age and no active session
          if (stat.isDirectory() && now - stat.mtimeMs > MAX_SESSION_AGE_MS) {
            await fs.rm(dirPath, { recursive: true, force: true });
            app.log.info({ dir }, "Cleaned up orphaned transcode directory");
          }
        }
      } catch {
        // transcode dir might not exist yet — ignore
      }
    })();
  }, CLEANUP_INTERVAL_MS);

  // Stop cleanup when server shuts down (graceful shutdown)
  app.addHook("onClose", async () => {
    clearInterval(cleanupInterval);

    // Kill all active ffmpeg processes
    for (const [id, session] of sessions) {
      session.process.kill();
      sessions.delete(id);
      app.log.info({ id }, "Killed transcode session on shutdown");
    }
  });
}

/** Wait for a file to appear on disk (ffmpeg takes a moment to start producing output) */
async function waitForFile(filePath: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(filePath)) {
      // File exists — wait a bit more for content
      const stat = await fs.stat(filePath);
      if (stat.size > 0) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}
