// src/electron/export.ts
// Export feature — copy original file or transcode to MP4 via ffmpeg.
// Like: a DVR "export to USB" or Plex "optimize" feature.
//
// Two modes:
//   "original" — instant copy of cached file (lossless, keeps MKV/TS format)
//   "mp4"      — ffmpeg transcode to H.264+AAC MP4 (universal, plays everywhere)
//   "mp4-720p" — same but downscaled to 720p (smaller file for phone)
//
// ffmpeg must be installed:
//   Windows: choco install ffmpeg  OR  scoop install ffmpeg
//   macOS: brew install ffmpeg
//   Linux: apt install ffmpeg

import { ipcMain, dialog } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { DiskCache } from "../cache/disk-cache.js";

type ExportFormat = "original" | "mp4" | "mp4-720p" | "mp4-480p";

interface ExportProgress {
  readonly status: "started" | "progress" | "done" | "error";
  readonly percent?: number;
  readonly message?: string;
  readonly outputPath?: string;
}

// Track active export processes
let currentExport: ChildProcess | null = null;

/**
 * Registers IPC handlers for video export.
 *
 * @param diskCache - Disk cache to locate cached video files.
 */
export function registerExportHandlers(diskCache: DiskCache): void {
  // Pick a destination folder — opens native OS folder picker
  // Like: JavaFX DirectoryChooser
  ipcMain.handle("pick-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Choose export destination",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }

    return { canceled: false, path: result.filePaths[0] };
  });

  // Export a video — copy original or transcode to MP4
  ipcMain.handle(
    "export-video",
    async (_event, url: string, destination: string, format: ExportFormat): Promise<ExportProgress> => {
      // Find the cached file
      const cached = await diskCache.get(url);
      if (!cached) {
        return { status: "error", message: "Video not in cache. Play it first." };
      }

      // Generate a clean filename from the URL
      const hash = createHash("md5").update(url).digest("hex").substring(0, 8);
      const ext = format === "original" ? getExtFromUrl(url) : "mp4";
      const filename = `rarebreed_${hash}.${ext}`;
      const outputPath = path.join(destination, filename);

      if (format === "original") {
        // Instant copy — no transcoding (like cp file destination/)
        try {
          await fs.copyFile(cached.filePath, outputPath);
          return { status: "done", outputPath };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Copy failed";
          return { status: "error", message: msg };
        }
      }

      // Transcode with ffmpeg
      return await transcodeToMp4(cached.filePath, outputPath, format);
    },
  );
}

/**
 * Transcodes a video file to MP4 using ffmpeg.
 * Like: ProcessBuilder("ffmpeg", "-i", input, ...).start()
 */
function transcodeToMp4(
  inputPath: string,
  outputPath: string,
  format: ExportFormat,
): Promise<ExportProgress> {
  return new Promise((resolve) => {
    // Kill previous export if running
    if (currentExport) {
      currentExport.kill();
    }

    // Build ffmpeg arguments
    // -i input — source file
    // -c:v libx264 — H.264 video codec (universal)
    // -c:a aac — AAC audio codec (universal)
    // -preset fast — speed/quality tradeoff
    // -movflags +faststart — enables streaming playback of the output
    const args: string[] = [
      "-i", inputPath,
      "-c:v", "libx264",
      "-c:a", "aac",
      "-preset", "fast",
      "-movflags", "+faststart",
      "-y", // overwrite output
    ];

    // Add resolution scaling if requested
    if (format === "mp4-720p") {
      args.push("-vf", "scale=-2:720"); // scale height to 720, width auto
    } else if (format === "mp4-480p") {
      args.push("-vf", "scale=-2:480");
    }

    args.push(outputPath);

    currentExport = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });

    let stderrOutput = "";

    currentExport.stderr?.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    currentExport.on("exit", (code) => {
      currentExport = null;
      if (code === 0) {
        resolve({ status: "done", outputPath });
      } else {
        resolve({
          status: "error",
          message: `ffmpeg exited with code ${String(code)}. ${stderrOutput.substring(0, 200)}`,
        });
      }
    });

    currentExport.on("error", (err) => {
      currentExport = null;
      if (err.message.includes("ENOENT")) {
        resolve({
          status: "error",
          message: "ffmpeg not found. Install: choco install ffmpeg",
        });
      } else {
        resolve({ status: "error", message: err.message });
      }
    });
  });
}

/** Extract file extension from URL (fallback to .ts) */
function getExtFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const ext = path.extname(pathname).replace(".", "");
  return ext || "ts";
}
