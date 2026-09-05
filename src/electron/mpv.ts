// src/electron/mpv.ts
// mpv integration — spawns mpv as a child process to play video.
// Like vlcj in Java: player.media().play(url)
// mpv plays everything: MKV, AVI, TS, HLS, RTMP, etc.
//
// mpv must be installed on the system:
//   Windows: choco install mpv  OR  scoop install mpv
//   macOS: brew install mpv
//   Linux: apt install mpv
//
// We route video through our /stream proxy so it gets disk-cached.

import { spawn, type ChildProcess } from "node:child_process";
import { ipcMain, dialog } from "electron";

let currentProcess: ChildProcess | null = null;

interface MpvOptions {
  /** Server port for stream proxy URLs. Default: 3000 */
  readonly port?: number;
  /** Path to mpv binary. Default: "mpv" (assumes it's in PATH) */
  readonly mpvPath?: string;
}

/**
 * Registers IPC handlers for mpv playback.
 * The renderer calls window.electronAPI.playVideo(url) → IPC → this handler → spawns mpv.
 *
 * @param options - mpv binary path and server port.
 */
export function registerMpvHandlers(options: MpvOptions = {}): void {
  const { port = 3000, mpvPath = "mpv" } = options;

  // IPC handler: renderer asks to play a video URL
  // Like: JavaFX event handler calling vlcj player.media().play(url)
  ipcMain.handle("play-video", (_event, url: string) => {
    // Kill previous mpv instance (only one video at a time)
    if (currentProcess) {
      currentProcess.kill();
      currentProcess = null;
    }

    // Route through our stream proxy for caching
    // The proxy fetches from IPTV, tees to disk, streams to mpv
    const streamUrl = `http://localhost:${String(port)}/stream?url=${encodeURIComponent(url)}`;

    // Spawn mpv with caching and sensible defaults
    // Like: new ProcessBuilder("vlc", "--cache", "5000", url).start()
    currentProcess = spawn(mpvPath, [
      streamUrl,
      "--cache=yes",               // enable stream caching in mpv too
      "--cache-secs=30",           // buffer 30s ahead
      "--demuxer-max-bytes=100M",  // allow large demuxer buffer
      "--force-window=yes",        // always show window
      "--keep-open=yes",           // don't close on end (for VOD)
      "--title=RareBreed Player",  // window title
      "--osd-level=1",             // show OSD (time, progress)
    ], {
      detached: false,
      stdio: "ignore",
    });

    currentProcess.on("exit", (code) => {
      console.log(`mpv exited with code ${String(code)}`);
      currentProcess = null;
    });

    currentProcess.on("error", (err) => {
      console.error("Failed to start mpv:", err.message);
      // Show dialog if mpv isn't installed
      if (err.message.includes("ENOENT")) {
        dialog.showErrorBox(
          "mpv not found",
          "mpv is required for video playback.\n\n" +
          "Install it:\n" +
          "  Windows: choco install mpv\n" +
          "  macOS: brew install mpv\n" +
          "  Linux: apt install mpv",
        );
      }
    });

    return { success: true, pid: currentProcess.pid };
  });

  // IPC handler: stop playback
  ipcMain.handle("stop-video", () => {
    if (currentProcess) {
      currentProcess.kill();
      currentProcess = null;
      return { success: true };
    }
    return { success: false, reason: "Nothing playing" };
  });
}
