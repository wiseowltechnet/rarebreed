import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

const STORAGE_KEY = 'woe-followed-series';

/** A followed series entry */
export interface FollowedSeries {
  /** Series ID from Xtream API */
  seriesId: number;
  /** Series name */
  name: string;
  /** Cover/poster URL */
  cover?: string;
  /** Category it belongs to */
  category?: string;
  /** When the user followed it */
  followedAt: number;
  /** Last episode watched (for "next up" tracking) */
  lastWatchedSeason?: number;
  lastWatchedEpisode?: number;
}

/**
 * Follow Service — manages series subscriptions.
 *
 * When you follow a series:
 * - It appears on your home page under "My Shows"
 * - Auto-cache can download episodes in background
 * - Auto-play knows to continue to the next episode
 * - You can see which episode you're up to
 */
@Injectable({ providedIn: 'root' })
export class FollowService {
  private readonly http = inject(HttpClient);
  private readonly followedMap = signal<Map<number, FollowedSeries>>(new Map());

  /** All followed series (sorted by most recently followed) */
  readonly followedSeries = computed(() =>
    [...this.followedMap().values()].sort((a, b) => b.followedAt - a.followedAt)
  );

  /** Count of followed series */
  readonly followCount = computed(() => this.followedMap().size);

  constructor() {
    this.load();
    // Auto-sync followed series to backend for background caching
    setTimeout(() => void this.syncToBackend(), 8000);
  }

  /** Check if a series is followed */
  isFollowed(seriesId: number): boolean {
    return this.followedMap().has(seriesId);
  }

  /** Follow a series */
  follow(series: { seriesId: number; name: string; cover?: string; category?: string }): void {
    const map = new Map(this.followedMap());
    map.set(series.seriesId, {
      ...series,
      followedAt: Date.now(),
    });
    this.followedMap.set(map);
    this.save();
    // Trigger background cache for this series
    void this.syncToBackend();
  }

  /** Unfollow a series */
  unfollow(seriesId: number): void {
    const map = new Map(this.followedMap());
    map.delete(seriesId);
    this.followedMap.set(map);
    this.save();
  }

  /** Toggle follow state */
  toggle(series: { seriesId: number; name: string; cover?: string; category?: string }): void {
    if (this.isFollowed(series.seriesId)) {
      this.unfollow(series.seriesId);
    } else {
      this.follow(series);
    }
  }

  /** Update the last watched episode for a followed series */
  updateProgress(seriesId: number, season: number, episodeNum: number): void {
    const map = new Map(this.followedMap());
    const entry = map.get(seriesId);
    if (entry) {
      entry.lastWatchedSeason = season;
      entry.lastWatchedEpisode = episodeNum;
      this.followedMap.set(map);
      this.save();
    }
  }

  /** Get the followed series entry */
  get(seriesId: number): FollowedSeries | undefined {
    return this.followedMap().get(seriesId);
  }

  // ─── Auto-Cache Sync ─── //

  /** Download status per series */
  readonly downloadStatus = signal<{
    seriesId: number;
    seriesName: string;
    totalEpisodes: number;
    cachedEpisodes: number;
    downloading: boolean;
    currentEpisode?: string;
  }[]>([]);

  /** Whether any series is currently downloading */
  readonly isDownloading = signal(false);

  /** Queue length */
  readonly queueLength = signal(0);

  /**
   * Sync followed series to backend — triggers auto-cache download.
   * Called automatically 8s after boot, and whenever follow state changes.
   */
  async syncToBackend(): Promise<void> {
    const followed = this.followedSeries();
    if (followed.length === 0) return;

    try {
      const result = await firstValueFrom(this.http.post<{
        synced: { seriesId: number; name: string; queued: number; alreadyCached: number }[];
        queueLength: number;
        isDownloading: boolean;
      }>('/follow/sync', {
        series: followed.map(s => ({ seriesId: s.seriesId, name: s.name })),
      }));

      this.queueLength.set(result.queueLength);
      this.isDownloading.set(result.isDownloading);
    } catch {
      // Backend unavailable — not critical
    }
  }

  /** Poll download status from backend */
  async refreshStatus(): Promise<void> {
    try {
      const result = await firstValueFrom(this.http.get<{
        status: {
          seriesId: number;
          seriesName: string;
          totalEpisodes: number;
          cachedEpisodes: number;
          downloading: boolean;
          currentEpisode?: string;
        }[];
        queueLength: number;
        isDownloading: boolean;
      }>('/follow/status'));

      this.downloadStatus.set(result.status);
      this.queueLength.set(result.queueLength);
      this.isDownloading.set(result.isDownloading);
    } catch {
      // non-critical
    }
  }

  // ─── Persistence ─── //

  private save(): void {
    try {
      const entries = [...this.followedMap().entries()];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch { /* localStorage full */ }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const entries = JSON.parse(raw) as [number, FollowedSeries][];
        this.followedMap.set(new Map(entries));
      }
    } catch { /* ignore */ }
  }
}
