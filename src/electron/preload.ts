// src/electron/preload.ts
// Runs in a sandboxed context between main process and renderer.
// Exposes specific Node.js APIs to the frontend safely.
// Like: JavaFX WebView's bridge between Java and JavaScript
//
// The renderer (HTML page) can call: window.electronAPI.saveVideo(url)
// The preload translates that to IPC messages to the main process.

import { contextBridge, ipcRenderer } from "electron";

// Expose a safe, typed API to the renderer (frontend HTML/JS)
// The frontend calls: window.electronAPI.methodName()
contextBridge.exposeInMainWorld("electronAPI", {
  /** Request mpv to play a URL */
  playVideo: (url: string) => ipcRenderer.invoke("play-video", url),

  /** Stop current mpv playback */
  stopVideo: () => ipcRenderer.invoke("stop-video"),

  /** Save a video for offline viewing (marks as permanent in cache) */
  saveForLater: (url: string) => ipcRenderer.invoke("save-for-later", url),

  /** Export a saved video to a folder */
  exportVideo: (url: string, destination: string, format: string) =>
    ipcRenderer.invoke("export-video", url, destination, format),

  /** Get list of saved videos */
  getSavedVideos: () => ipcRenderer.invoke("get-saved-videos"),

  /** Open a folder picker dialog */
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
});
