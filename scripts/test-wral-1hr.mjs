#!/usr/bin/env node
/**
 * WRAL 1-Hour Live Stream Stability Test
 *
 * Tests that the live stream stays connected for 1 hour.
 * Checks every 30s that bytes are flowing. Reports bitrate, total data, interruptions.
 *
 * Usage: node scripts/test-wral-1hr.mjs
 * (Make sure the server is running at localhost:3000 first)
 */

const STREAM_URL = "http://your-iptv-server:8080/live/your-username/your-password/91144.ts";
const SERVER_URL = "http://127.0.0.1:3000/stream?url=" + encodeURIComponent(STREAM_URL);
const DURATION_MS = 60 * 60 * 1000; // 1 hour
const CHECK_INTERVAL_MS = 30_000; // check every 30s

console.log("═══════════════════════════════════════════════════════");
console.log("  Wise Owl Entertainment — WRAL Live Stream Test");
console.log("  Channel: NC | Raleigh | NBC 5 WRAL");
console.log("  Duration: 1 hour");
console.log("  Started:", new Date().toLocaleString());
console.log("═══════════════════════════════════════════════════════");
console.log("");

let totalBytes = 0;
let lastBytes = 0;
let checks = 0;
let errors = 0;
let reconnects = 0;
let startTime = Date.now();
let lastCheckTime = Date.now();
let reader = null;
let aborted = false;

async function connect() {
  try {
    const controller = new AbortController();
    // Only use signal for initial connection. Once connected, remove timeout.
    const connectTimeout = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(SERVER_URL, {
      headers: { Cookie: "auth=true" },
      signal: controller.signal,
    });

    clearTimeout(connectTimeout); // connected — don't abort body reads

    if (!response.ok) {
      console.log(`[${timestamp()}] ERROR: Server returned ${response.status}`);
      errors++;
      return false;
    }

    console.log(`[${timestamp()}] Connected — Content-Type: ${response.headers.get("content-type")}, X-Cache: ${response.headers.get("x-cache")}`);
    reader = response.body.getReader();
    return true;
  } catch (err) {
    console.log(`[${timestamp()}] ERROR connecting: ${err.message}`);
    errors++;
    return false;
  }
}

async function readChunks() {
  while (!aborted) {
    try {
      const { value, done } = await reader.read();
      if (done) {
        console.log(`[${timestamp()}] Stream ended (unexpected for live)`);
        errors++;
        break;
      }
      totalBytes += value.length;
    } catch (err) {
      if (!aborted) {
        console.log(`[${timestamp()}] Read error: ${err.message}`);
        errors++;
        break;
      }
    }
  }
}

function checkStatus() {
  const now = Date.now();
  const elapsed = (now - startTime) / 1000;
  const intervalBytes = totalBytes - lastBytes;
  const intervalSecs = (now - lastCheckTime) / 1000;
  const bitrate = Math.round((intervalBytes * 8) / intervalSecs / 1000);
  const totalMB = (totalBytes / 1024 / 1024).toFixed(1);

  checks++;

  if (intervalBytes === 0) {
    console.log(`[${timestamp()}] ⚠ NO DATA received in last ${intervalSecs.toFixed(0)}s — stream may be stalled`);
    errors++;
  } else {
    console.log(`[${timestamp()}] ✓ ${bitrate} kbps | Total: ${totalMB} MB | Elapsed: ${formatTime(elapsed)} | Errors: ${errors}`);
  }

  lastBytes = totalBytes;
  lastCheckTime = now;
}

function timestamp() {
  return new Date().toLocaleTimeString();
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}m ${s}s`;
}

// Main loop
async function main() {
  // Connect
  const connected = await connect();
  if (!connected) {
    console.log("Failed to connect. Is the server running? (node --env-file=.env dist/server.js)");
    process.exit(1);
  }

  // Start reading chunks in background
  const readPromise = readChunks();

  // Status check interval
  const interval = setInterval(checkStatus, CHECK_INTERVAL_MS);

  // Stop after 1 hour
  setTimeout(() => {
    aborted = true;
    reader?.cancel();
    clearInterval(interval);

    const elapsed = (Date.now() - startTime) / 1000;
    const avgBitrate = Math.round((totalBytes * 8) / elapsed / 1000);
    const totalMB = (totalBytes / 1024 / 1024).toFixed(1);

    console.log("");
    console.log("═══════════════════════════════════════════════════════");
    console.log("  TEST COMPLETE");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`  Duration:       ${formatTime(elapsed)}`);
    console.log(`  Total Data:     ${totalMB} MB`);
    console.log(`  Avg Bitrate:    ${avgBitrate} kbps`);
    console.log(`  Status Checks:  ${checks}`);
    console.log(`  Errors:         ${errors}`);
    console.log(`  Reconnects:     ${reconnects}`);
    console.log(`  Result:         ${errors === 0 ? "✅ PASS" : errors < 3 ? "⚠ PASS (minor issues)" : "❌ FAIL"}`);
    console.log("═══════════════════════════════════════════════════════");

    process.exit(errors > 5 ? 1 : 0);
  }, DURATION_MS);

  console.log(`[${timestamp()}] Streaming... (will run for 1 hour)`);
  console.log(`[${timestamp()}] Press Ctrl+C to stop early`);
  console.log("");

  await readPromise;
}

// Handle Ctrl+C
process.on("SIGINT", () => {
  aborted = true;
  console.log("\n\nTest interrupted by user.");
  process.exit(0);
});

main();
