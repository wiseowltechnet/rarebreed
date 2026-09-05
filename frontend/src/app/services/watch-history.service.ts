import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

const STORAGE_KEY = 'woe-watch-history';

/** Watch progress for a single episode */
export interface WatchProgress {
  /** Stream URL (unique key) */
  url: string;
  /** Episode/movie name */
  name: string;
  /** Series name (if part of a series) */
  seriesName?: string;
  /** Series ID (for grouping) */
  seriesId?: number;
  /** Season number */
  season?: number;
  /** Episode number within season */
  episodeNum?: number;
  /** Current playback position in seconds */
  position: number;
  /** Total duration in seconds */
  duration: number;
  /** Whether episode is considered "watched" (>90% complete) */
  completed: boolean;
  /** Timestamp when last watched */
  lastWatched: number;
  /** Timestamp when marked completed */
  completedAt?: number;
}

/**
 * Watch History Service — tracks playback progress for every episode/movie.
 *
 * - Saves position so you can resume where you fell asleep
 * - Marks as "completed" when >90% watched
 * - Persists to localStorage (instant) + could sync to backend
 * - Used by auto-play to determine next unwatched episode
 */
@Injectable({ providedIn: 'root' })
export class WatchHistoryService {
  private readonly http = inject(HttpClient);
  private readonly history = signal<Map<string, WatchProgress>>(new Map());

  /** All watch progress entries as array (sorted by last watched) */
  readonly entries = computed(() =>
    [...this.history().values()].sort((a, b) => b.lastWatched - a.lastWatched)
  );

  /** Recently watched (last 20, not completed) — for "Continue Watching" */
  readonly continueWatching = computed(() =>
    this.entries()
      .filter(e => !e.completed && e.position > 30) // watched at least 30s
      .slice(0, 20)
  );

  /** Completed episodes (for auto-delete scheduling) */
  readonly completedEpisodes = computed(() =>
    this.entries().filter(e => e.completed)
  );

  constructor() {
    this.load();
    this.startAutoSync();
  }

  /**
   * Update watch progress for an episode.
   * Called periodically during playback (every 10s).
   */
  updateProgress(url: string, position: number, duration: number): void {
    const map = new Map(this.history());
    const existing = map.get(url);

    if (existing) {
      existing.position = position;
      existing.duration = duration;
      existing.lastWatched = Date.now();

      // Mark as completed when >90% watched
      if (duration > 0 && position / duration > 0.9 && !existing.completed) {
        existing.completed = true;
        existing.completedAt = Date.now();
      }
    }

    this.history.set(map);
    this.save();
  }

  /**
   * Start tracking a new episode.
   * Called when playback begins.
   */
  startWatching(params: {
    url: string;
    name: string;
    seriesName?: string;
    seriesId?: number;
    season?: number;
    episodeNum?: number;
  }): void {
    const map = new Map(this.history());
    const existing = map.get(params.url);

    if (existing) {
      // Resume — just update timestamp
      existing.lastWatched = Date.now();
    } else {
      // New entry
      map.set(params.url, {
        ...params,
        position: 0,
        duration: 0,
        completed: false,
        lastWatched: Date.now(),
      });
    }

    this.history.set(map);
    this.save();
  }

  /**
   * Get resume position for a URL (0 if not watched before).
   */
  getResumePosition(url: string): number {
    const entry = this.history().get(url);
    if (!entry || entry.completed) return 0;
    // Resume 5s before where they stopped (in case they missed something)
    return Math.max(0, entry.position - 5);
  }

  /**
   * Check if an episode is completed.
   */
  isCompleted(url: string): boolean {
    return this.history().get(url)?.completed ?? false;
  }

  /**
   * Get progress percentage (0-100) for an episode.
   */
  getProgress(url: string): number {
    const entry = this.history().get(url);
    if (!entry || entry.duration === 0) return 0;
    return Math.round((entry.position / entry.duration) * 100);
  }

  /**
   * Mark episode as completed manually (e.g. "Mark as watched" button).
   */
  markCompleted(url: string): void {
    const map = new Map(this.history());
    const entry = map.get(url);
    if (entry) {
      entry.completed = true;
      entry.completedAt = Date.now();
      this.history.set(map);
      this.save();
    }
  }

  /**
   * Get all completed episodes older than X days (for auto-delete).
   */
  getStaleCompleted(daysOld: number): WatchProgress[] {
    const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    return this.completedEpisodes().filter(e =>
      e.completedAt !== undefined && e.completedAt < cutoff
    );
  }

  /**
   * Remove an entry from history.
   */
  remove(url: string): void {
    const map = new Map(this.history());
    map.delete(url);
    this.history.set(map);
    this.save();
  }

  // ─── Auto-Sync to Backend ─── //

  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private readonly SYNC_KEY = 'woe-last-sync';

  /**
   * Periodically syncs completed episodes to the backend for auto-delete scheduling.
   * Runs every 5 minutes. Only sends episodes not yet synced.
   */
  private startAutoSync(): void {
    // Sync after 10s (let app boot), then every 5 min
    setTimeout(() => void this.syncCompleted(), 10_000);
    this.syncTimer = setInterval(() => void this.syncCompleted(), 5 * 60 * 1000);
  }

  private async syncCompleted(): Promise<void> {
    const completed = this.completedEpisodes();
    if (completed.length === 0) return;

    // Only sync episodes we haven't already reported
    const lastSync = Number(localStorage.getItem(this.SYNC_KEY) ?? '0');
    const unsyncedEpisodes = completed.filter(e =>
      e.completedAt !== undefined && e.completedAt > lastSync
    );

    if (unsyncedEpisodes.length === 0) return;

    try {
      await firstValueFrom(this.http.post('/watch/report-completed', {
        episodes: unsyncedEpisodes.map(e => ({
          url: e.url,
          name: e.name,
          completedAt: e.completedAt,
        })),
      }));
      localStorage.setItem(this.SYNC_KEY, String(Date.now()));
    } catch {
      // Backend unavailable — will retry next interval
    }
  }

  // ─── Persistence ─── //

  private save(): void {
    try {
      const entries = [...this.history().entries()];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch { /* localStorage full */ }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const entries = JSON.parse(raw) as [string, WatchProgress][];
        this.history.set(new Map(entries));
      }
    } catch { /* ignore */ }
  }
}
