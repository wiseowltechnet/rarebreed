// src/routes/live-hls.ts
// Live TV → HLS segmenter with 5-minute rolling buffer.
//
// How it works:
//   1. Client requests /live-hls/start?url=<live_stream_url>
//   2. We spawn ffmpeg: reads the live .ts stream, outputs 10s HLS segments
//   3. Segments + playlist stored in a temp dir per channel
//   4. Client plays the .m3u8 via HLS.js — gets pause, seek within 5min window
//   5. ffmpeg keeps only the last 30 segments (5 min) — old ones auto-deleted
//   6. When client disconnects or calls /live-hls/stop, we kill ffmpeg + cleanup
//
// Like: Nginx RTMP module's HLS output, or Spring + ProcessBuilder piping ffmpeg.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

/** Tracks one active live-HLS session */
interface HlsSession {
  id: string;
  url: string;
  process: ChildProcess;
  dir: string;
  startedAt: number;
}

/** Map of sessionId → active session */
const sessions = new Map<string, HlsSession>();

/** Max segments ffmpeg keeps in the playlist (5 min ÷ 10s = 30) */
const HLS_LIST_SIZE = 30;

/** Segment duration in seconds */
const SEGMENT_DURATION = 10;

/**
 * Creates a unique temp directory for a live-HLS session.
 */
function createSessionDir(): string {
  const id = randomBytes(8).toString("hex");
  const dir = join(tmpdir(), "rarebreed-hls", id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Spawns ffmpeg to segment a live stream into HLS chunks.
 *
 * @param url - The live stream URL (e.g. http://your-iptv-server:8080/live/.../91144.ts)
 * @param outputDir - Directory where .m3u8 + .ts segments are written
 * @returns The ffmpeg ChildProcess
 */
function spawnSegmenter(url: string, outputDir: string): ChildProcess {
  const playlistPath = join(outputDir, "live.m3u8");

  // ffmpeg args:
  //   -i <url>              read live stream
  //   -c copy               no re-encoding (fast, zero CPU)
  //   -f hls                output HLS format
  //   -hls_time 10          10-second segments
  //   -hls_list_size 30     keep 30 segments in playlist (5 min)
  //   -hls_flags delete_segments+append_list
  //                         auto-delete old .ts files + append to playlist
  //   -hls_segment_filename pattern for segment naming
  const args = [
    "-hide_banner",
    "-loglevel", "warning",
    "-i", url,
    "-c", "copy",
    "-f", "hls",
    "-hls_time", String(SEGMENT_DURATION),
    "-hls_list_size", String(HLS_LIST_SIZE),
    "-hls_flags", "delete_segments+append_list",
    "-hls_segment_filename", join(outputDir, "seg_%05d.ts"),
    playlistPath,
  ];

  const proc = spawn("ffmpeg", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    if (msg.length > 0) {
      // Only log actual errors, not the verbose ffmpeg output
      if (msg.includes("Error") || msg.includes("error")) {
        console.error(`[live-hls] ffmpeg error: ${msg}`);
      }
    }
  });

  return proc;
}

/**
 * Cleans up a session: kill ffmpeg, remove temp files.
 */
function destroySession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Kill ffmpeg
  session.process.kill("SIGTERM");

  // Clean up temp dir (best-effort)
  try {
    const files = readdirSync(session.dir);
    for (const file of files) {
      try {
        unlinkSync(join(session.dir, file));
      } catch { /* ignore */ }
    }
    // Remove the dir itself
    try {
      const { rmdirSync } = require("node:fs") as typeof import("node:fs");
      rmdirSync(session.dir);
    } catch { /* ignore */ }
  } catch { /* dir may already be gone */ }

  sessions.delete(sessionId);
}

/**
 * Registers live-HLS routes:
 *   POST /live-hls/start  — start a live-HLS session
 *   GET  /live-hls/:id/live.m3u8 — serve the HLS playlist
 *   GET  /live-hls/:id/:segment   — serve a .ts segment
 *   POST /live-hls/:id/stop       — stop session + cleanup
 *   GET  /live-hls/sessions       — list active sessions
 */
export async function liveHlsRoutes(app: FastifyInstance): Promise<void> {
  // ─── Start a new live-HLS session ───
  app.post(
    "/start",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { url } = request.body as { url?: string };

      if (!url) {
        return reply.status(400).send({ error: "Missing url in body" });
      }

      // Check if we already have a session for this URL
      for (const [id, session] of sessions) {
        if (session.url === url) {
          return reply.send({
            sessionId: id,
            playlist: `/live-hls/${id}/live.m3u8`,
            reused: true,
          });
        }
      }

      // Create new session
      const dir = createSessionDir();
      const sessionId = dir.split(/[\\/]/).pop()!;
      const proc = spawnSegmenter(url, dir);

      const session: HlsSession = {
        id: sessionId,
        url,
        process: proc,
        dir,
        startedAt: Date.now(),
      };

      sessions.set(sessionId, session);

      // Auto-cleanup if ffmpeg exits unexpectedly
      proc.on("exit", (code) => {
        if (sessions.has(sessionId)) {
          console.log(`[live-hls] ffmpeg exited (code=${String(code)}) for session ${sessionId}`);
          sessions.delete(sessionId);
        }
      });

      // Wait a moment for ffmpeg to produce the first segment
      await new Promise((resolve) => setTimeout(resolve, 2000));

      return reply.send({
        sessionId,
        playlist: `/live-hls/${sessionId}/live.m3u8`,
        reused: false,
        bufferWindow: `${HLS_LIST_SIZE * SEGMENT_DURATION}s (${HLS_LIST_SIZE * SEGMENT_DURATION / 60} min)`,
      });
    },
  );

  // ─── Serve .m3u8 playlist ───
  app.get(
    "/:id/live.m3u8",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const session = sessions.get(id);

      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }

      const playlistPath = join(session.dir, "live.m3u8");
      if (!existsSync(playlistPath)) {
        return reply.status(503).send({ error: "Playlist not ready yet — ffmpeg still starting" });
      }

      return reply
        .header("Content-Type", "application/vnd.apple.mpegurl")
        .header("Cache-Control", "no-cache, no-store")
        .sendFile("live.m3u8", session.dir);
    },
  );

  // ─── Serve .ts segments ───
  app.get(
    "/:id/:segment",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, segment } = request.params as { id: string; segment: string };
      const session = sessions.get(id);

      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }

      // Only serve .ts files (security: no path traversal)
      if (!segment.endsWith(".ts") || segment.includes("..")) {
        return reply.status(400).send({ error: "Invalid segment name" });
      }

      const segPath = join(session.dir, segment);
      if (!existsSync(segPath)) {
        return reply.status(404).send({ error: "Segment not found (may have been evicted)" });
      }

      return reply
        .header("Content-Type", "video/mp2t")
        .header("Cache-Control", "no-cache")
        .sendFile(segment, session.dir);
    },
  );

  // ─── Stop a session ───
  app.post(
    "/:id/stop",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      if (!sessions.has(id)) {
        return reply.status(404).send({ error: "Session not found" });
      }

      destroySession(id);
      return reply.send({ stopped: true });
    },
  );

  // ─── List active sessions ───
  app.get(
    "/sessions",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const list = Array.from(sessions.values()).map((s) => ({
        id: s.id,
        url: s.url,
        uptime: `${Math.round((Date.now() - s.startedAt) / 1000)}s`,
        playlist: `/live-hls/${s.id}/live.m3u8`,
      }));
      return reply.send(list);
    },
  );

  // ─── Cleanup all sessions on server shutdown ───
  app.addHook("onClose", async () => {
    for (const id of sessions.keys()) {
      destroySession(id);
    }
  });
}
