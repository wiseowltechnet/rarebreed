// src/m3u-parser.ts
// Replaces: M3UParser.java
// In Java: @Singleton class with @Inject dependencies
// In TS: a pure function — no class, no DI, just input → output

// Channel shape — like a Java record/POJO but zero boilerplate
interface Channel {
  readonly name: string;
  readonly url: string;
  readonly group: string;
}

// Parse M3U playlist content into typed Channel objects
// Java equivalent: List<Channel> parseM3U(String content)
/**
 * Parses M3U playlist content into structured channel objects.
 * Handles #EXTINF metadata including group-title. Skips comments and blank lines.
 *
 * @param content - Raw M3U file content (lines separated by \n).
 * @returns Parsed channels with name, URL, and group. Empty array if no valid entries.
 */
export function parseM3U(content: string): Channel[] {
  const lines = content.split("\n");
  const channels: Channel[] = [];

  let currentName = "";
  let currentGroup = "";

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "") {
      continue;
    }

    // #EXTINF lines hold metadata: #EXTINF:-1 group-title="Sports",ESPN
    if (trimmed.startsWith("#EXTINF:")) {
      // Regex capture: group-title="..."
      const groupRegex = /group-title="([^"]*)"/;
      const groupMatch = groupRegex.exec(trimmed);
      currentGroup = groupMatch?.[1] ?? "Uncategorized";

      // Channel name is after the last comma
      const commaIndex = trimmed.lastIndexOf(",");
      currentName =
        commaIndex !== -1 ? trimmed.substring(commaIndex + 1).trim() : "Unknown Channel";
    } else if (!trimmed.startsWith("#")) {
      // Non-comment line = stream URL
      channels.push({
        name: currentName || "Channel " + String(channels.length + 1),
        url: trimmed,
        group: currentGroup,
      });
      currentName = "";
      currentGroup = "";
    }
  }

  return channels;
}

export type { Channel };
