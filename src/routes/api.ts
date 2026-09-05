// src/routes/api.ts
// REST API for features that also work via Electron IPC.
// In desktop mode: frontend uses window.electronAPI (IPC)
// In server mode: frontend calls these HTTP endpoints instead.
//
// This makes every feature accessible from ANY browser — no Electron needed.

import type { FastifyInstance } from "fastify";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

let currentMpv: ChildProcess | null = null;

/**
 * Registers REST API routes for play, save, export, and library.
 * These mirror the Electron IPC handlers but work over HTTP.
 *
 * @param app - Fastify instance with diskCache decorated.
 */
export async function apiRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/play — spawn mpv on the server to play a video
  // Body: { url: string }
  app.post<{ Body: { url: string } }>("/play", async (request, reply) => {
    const { url } = request.body;

    if (!url) {
      return await reply.status(400).send({ error: "Missing url" });
    }

    // Kill previous mpv instance
    if (currentMpv) {
      currentMpv.kill();
      currentMpv = null;
    }

    // Route through stream proxy for caching
    const port = (request.server.addresses()[0] as { port: number } | undefined)?.port ?? 3000;
    const streamUrl = `http://localhost:${String(port)}/stream?url=${encodeURIComponent(url)}`;

    try {
      currentMpv = spawn("mpv", [
        streamUrl,
        "--cache=yes",
        "--cache-secs=30",
        "--demuxer-max-bytes=100M",
        "--force-window=yes",
        "--keep-open=yes",
        "--title=RareBreed Player",
        "--osd-level=1",
      ], { detached: false, stdio: "ignore" });

      currentMpv.on("exit", () => { currentMpv = null; });
      currentMpv.on("error", () => { currentMpv = null; });

      return await reply.send({ success: true, pid: currentMpv.pid });
    } catch {
      return await reply.status(500).send({
        error: "Failed to start mpv. Install: choco install mpv",
      });
    }
  });

  // POST /api/stop — stop current mpv playback
  app.post("/stop", async (_request, reply) => {
    if (currentMpv) {
      currentMpv.kill();
      currentMpv = null;
      return await reply.send({ success: true });
    }
    return await reply.send({ success: false, reason: "Nothing playing" });
  });

  // POST /api/save — mark a cached video as permanent (no eviction)
  // Body: { url: string, name?: string }
  app.post<{ Body: { url: string; name?: string } }>("/save", async (request, reply) => {
    const { url, name } = request.body;

    if (!url) {
      return await reply.status(400).send({ error: "Missing url" });
    }

    const success = await app.diskCache.save(url, name);

    if (success) {
      return await reply.send({ success: true, url, name });
    }
    return await reply.status(404).send({
      error: "Video not in cache. Play it first to download.",
    });
  });

  // GET /api/library — list all saved videos
  app.get("/library", async (_request, reply) => {
    const saved = await app.diskCache.getSaved();
    return await reply.send(saved);
  });

  // POST /api/export — export a saved video (copy original or transcode to MP4)
  // Body: { url: string, format: "original" | "mp4" | "mp4-720p" | "mp4-480p" }
  // Server exports to EXPORT_DIR (configured in .env)
  app.post<{ Body: { url: string; format: string } }>("/export", async (request, reply) => {
    const { url, format } = request.body;

    if (!url || !format) {
      return await reply.status(400).send({ error: "Missing url or format" });
    }

    // Export directory from env (no native dialog in browser mode)
    const exportDir = process.env.EXPORT_DIR ?? path.join(process.cwd(), "exports");
    await fs.mkdir(exportDir, { recursive: true });

    // Find cached file
    const cached = await app.diskCache.get(url);
    if (!cached) {
      return await reply.status(404).send({
        error: "Video not in cache. Play it first.",
      });
    }

    // Generate filename
    const hash = createHash("md5").update(url).digest("hex").substring(0, 8);
    const ext = format === "original" ? getExtFromUrl(url) : "mp4";
    const filename = `rarebreed_${hash}.${ext}`;
    const outputPath = path.join(exportDir, filename);

    if (format === "original") {
      // Instant copy
      try {
        await fs.copyFile(cached.filePath, outputPath);
        return await reply.send({ status: "done", outputPath });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Copy failed";
        return await reply.status(500).send({ error: msg });
      }
    }

    // Transcode with ffmpeg
    const result = await transcode(cached.filePath, outputPath, format);
    if (result.success) {
      return await reply.send({ status: "done", outputPath });
    }
    return await reply.status(500).send({ error: result.error });
  });
}

/** Extract extension from URL */
function getExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).replace(".", "");
    return ext || "ts";
  } catch {
    return "ts";
  }
}

/** Transcode with ffmpeg — returns success/error */
function transcode(
  inputPath: string,
  outputPath: string,
  format: string,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const args: string[] = [
      "-i", inputPath,
      "-c:v", "libx264",
      "-c:a", "aac",
      "-preset", "fast",
      "-movflags", "+faststart",
      "-y",
    ];

    if (format === "mp4-720p") args.push("-vf", "scale=-2:720");
    else if (format === "mp4-480p") args.push("-vf", "scale=-2:480");

    args.push(outputPath);

    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("exit", (code) => {
      if (code === 0) resolve({ success: true });
      else resolve({ success: false, error: `ffmpeg exit ${String(code)}: ${stderr.substring(0, 200)}` });
    });

    proc.on("error", (err) => {
      if (err.message.includes("ENOENT")) {
        resolve({ success: false, error: "ffmpeg not found. Install: choco install ffmpeg" });
      } else {
        resolve({ success: false, error: err.message });
      }
    });
  });
}
