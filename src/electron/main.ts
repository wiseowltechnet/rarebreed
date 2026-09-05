// src/electron/main.ts
// Electron main process — like JavaFX Application.start()
// Starts the Fastify backend, then opens a Chromium window pointing at it.
//
// Main process = Node.js (full filesystem, child_process, etc.)
// Renderer process = Chromium (your HTML/CSS UI, sandboxed)

import { app, BrowserWindow, shell } from "electron";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { registerGracefulShutdown } from "../graceful-shutdown.js";
import { registerMpvHandlers } from "./mpv.js";
import { registerLibraryHandlers } from "./library.js";
import { registerExportHandlers } from "./export.js";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;

/**
 * Creates the main application window.
 * Like: JavaFX stage.setScene(new Scene(webView, 1280, 800));
 */
function createWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "RareBreed Player",
    // Security: disable node integration in renderer (like JavaFX sandboxing WebView)
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Load our Fastify server UI
  void mainWindow.loadURL(`http://localhost:${String(port)}`);

  // Open external links in system browser (not in Electron)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * Application boot sequence:
 * 1. Start Fastify server (backend)
 * 2. Open window (frontend)
 * Like: SpringApplication.run() then JavaFX Application.launch()
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const server = await buildApp();

  // Start the backend
  const address = await server.listen({ port: config.port });
  console.log(`Backend running at ${address}`);
  registerGracefulShutdown(server);

  // Register mpv IPC handlers (play-video, stop-video)
  registerMpvHandlers({ port: config.port });

  // Register library IPC handlers (save-for-later, get-saved-videos)
  registerLibraryHandlers(server.diskCache);

  // Register export IPC handlers (export-video, pick-folder)
  registerExportHandlers(server.diskCache);

  // Open the window
  createWindow(config.port);
}

// Electron lifecycle — like JavaFX Application lifecycle methods
// app.whenReady() = Application.init() + start()
app.whenReady().then(() => {
  void bootstrap();
}).catch((err: unknown) => {
  console.error("Failed to start:", err);
  app.quit();
});

// Quit when all windows closed (Windows/Linux behavior)
// macOS keeps apps running until Cmd+Q — handled separately
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// macOS: re-create window when dock icon clicked
app.on("activate", () => {
  if (mainWindow === null) {
    const config = loadConfig();
    createWindow(config.port);
  }
});
