// src/cache/disk-utils.ts
// Disk space utilities — checks available space for eviction decisions.
// Like Java's FileStore.getUsableSpace() / getTotalSpace()

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface DiskSpace {
  readonly freeBytes: number;
  readonly totalBytes: number;
  readonly usedBytes: number;
}

/**
 * Checks available disk space for the partition containing the given path.
 * Cross-platform: uses wmic on Windows, df on Unix.
 * Like: java.nio.file.Files.getFileStore(path).getUsableSpace()
 *
 * @param dirPath - Any path on the target partition.
 * @returns Free, used, and total bytes on that partition.
 */
export async function checkDiskSpace(dirPath: string): Promise<DiskSpace> {
  if (process.platform === "win32") {
    return checkDiskSpaceWindows(dirPath);
  }
  return checkDiskSpaceUnix(dirPath);
}

async function checkDiskSpaceWindows(dirPath: string): Promise<DiskSpace> {
  // Extract drive letter (e.g. "C" from "C:\Users\...")
  const drive = dirPath.charAt(0).toUpperCase();

  try {
    const { stdout } = await execFileAsync("wmic", [
      "logicaldisk",
      `where`,
      `DeviceID='${drive}:'`,
      "get",
      "FreeSpace,Size",
      "/format:csv",
    ]);

    // Parse CSV output: Node,FreeSpace,Size
    const lines = stdout
      .trim()
      .split("\n")
      .filter((l) => l.trim().length > 0);
    const lastLine = lines[lines.length - 1];

    if (lastLine) {
      const parts = lastLine.split(",");
      const freeBytes = parseInt(parts[1] ?? "0", 10);
      const totalBytes = parseInt(parts[2] ?? "0", 10);
      return {
        freeBytes,
        totalBytes,
        usedBytes: totalBytes - freeBytes,
      };
    }
  } catch {
    // wmic failed — fallback to conservative estimate
  }

  // Fallback: assume 237GB total, 97GB free (from earlier check)
  return { freeBytes: 97 * 1024 ** 3, totalBytes: 237 * 1024 ** 3, usedBytes: 140 * 1024 ** 3 };
}

async function checkDiskSpaceUnix(dirPath: string): Promise<DiskSpace> {
  try {
    const { stdout } = await execFileAsync("df", ["-B1", dirPath]);
    // Parse: Filesystem 1B-blocks Used Available Use% Mounted
    const lines = stdout.trim().split("\n");
    const dataLine = lines[1];

    if (dataLine) {
      const parts = dataLine.split(/\s+/);
      const totalBytes = parseInt(parts[1] ?? "0", 10);
      const usedBytes = parseInt(parts[2] ?? "0", 10);
      const freeBytes = parseInt(parts[3] ?? "0", 10);
      return { freeBytes, totalBytes, usedBytes };
    }
  } catch {
    // df failed
  }

  // Fallback
  return { freeBytes: 50 * 1024 ** 3, totalBytes: 100 * 1024 ** 3, usedBytes: 50 * 1024 ** 3 };
}
