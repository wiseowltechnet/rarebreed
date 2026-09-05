// src/electron/library.ts
// IPC handlers for save-for-later and library management.
// The renderer calls window.electronAPI.saveForLater(url) → IPC → this handler.
// Like: a DVR "keep recording" button that prevents auto-deletion.

import { ipcMain } from "electron";
import type { DiskCache } from "../cache/disk-cache.js";

/**
 * Registers IPC handlers for the video library (save, list saved).
 * Requires the disk cache instance from app.ts.
 *
 * @param diskCache - The disk cache to mark entries as saved.
 */
export function registerLibraryHandlers(diskCache: DiskCache): void {
  // Save a video for later — marks it as permanent (no eviction)
  // Like: DVR "keep" button, or Ehcache pin(key)
  ipcMain.handle("save-for-later", async (_event, url: string, name?: string) => {
    const success = await diskCache.save(url, name);
    return { success, url, name };
  });

  // Get all saved videos — for the offline library UI
  ipcMain.handle("get-saved-videos", async () => {
    const saved = await diskCache.getSaved();
    return saved;
  });
}
