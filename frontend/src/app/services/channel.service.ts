import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

const CACHE_KEY_TREE = 'woe-tree';
const CACHE_KEY_CHANNELS = 'woe-channels-cache';
const CACHE_TTL = 10 * 60_000; // 10 min local cache

/** Category within a content type */
export interface Category {
  readonly id: string;
  readonly name: string;
}

/** Top-level content type (Live TV, Movies, Series) */
export interface ContentTypeNode {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly categories: Category[];
}

/** Channel/stream entry */
export interface Channel {
  readonly name: string;
  readonly url: string;
  readonly icon?: string;
  readonly id: number;
}

/** Series season with episodes */
export interface Season {
  readonly season: number;
  readonly episodes: Channel[];
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Channel service — uses Xtream API for fast tree-style navigation.
 * Multi-layer cache: localStorage (instant) → server memory → Redis → Xtream API.
 *
 * Flow:
 *   1. Page loads → tree from localStorage (0ms)
 *   2. Background refresh from /xtream/tree (server cache: ~1ms)
 *   3. Click category → channels from localStorage or /xtream/channels (~1ms)
 *   4. Only on cold start: actual Xtream API call (~1-2s)
 */
@Injectable({ providedIn: 'root' })
export class ChannelService {
  private readonly http = inject(HttpClient);

  /** Navigation tree (Live TV / Movies / Series with subcategories) */
  readonly tree = signal<ContentTypeNode[]>([]);

  /** Currently selected content type (live, vod, series) */
  readonly selectedType = signal<ContentTypeNode | null>(null);

  /** Currently selected category */
  readonly selectedCategory = signal<Category | null>(null);

  /** Channels for the selected category */
  readonly channels = signal<Channel[]>([]);

  /** Series seasons (when browsing a series) */
  readonly seasons = signal<Season[]>([]);

  /** Current search term */
  readonly searchTerm = signal('');

  /** Loading states */
  readonly isLoadingTree = signal(false);
  readonly isLoadingChannels = signal(false);

  /** Error messages */
  readonly error = signal('');

  /** Filtered channels based on search */
  readonly filteredChannels = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const all = this.channels();
    if (!term) return all;
    return all.filter(ch => ch.name.toLowerCase().includes(term));
  });

  /** Channel count */
  readonly channelCount = computed(() => this.channels().length);

  constructor() {
    // Load tree from localStorage (instant — no network)
    this.loadTreeFromCache();
    // Background refresh from server
    void this.loadTree();
  }

  /** Load the category tree (Live TV / Movies / Series) */
  async loadTree(): Promise<void> {
    this.isLoadingTree.set(true);
    this.error.set('');

    try {
      const tree = await firstValueFrom(
        this.http.get<ContentTypeNode[]>('/xtream/tree')
      );
      this.tree.set(tree);
      this.saveTreeToCache(tree);
    } catch (err) {
      // Don't overwrite cached tree on error — show stale data
      if (this.tree().length === 0) {
        this.error.set('Failed to load categories');
      }
    } finally {
      this.isLoadingTree.set(false);
    }
  }

  /** Select a content type (Live TV, Movies, Series) */
  selectType(type: ContentTypeNode): void {
    this.selectedType.set(type);
    this.selectedCategory.set(null);
    this.channels.set([]);
    this.seasons.set([]);
    this.searchTerm.set('');
  }

  /** Select a category and load its channels */
  async selectCategory(category: Category): Promise<void> {
    const type = this.selectedType();
    if (!type) return;

    this.selectedCategory.set(category);
    this.channels.set([]);
    this.seasons.set([]);
    this.searchTerm.set('');

    // Check localStorage cache first
    const cached = this.getChannelsFromCache(type.id, category.id);
    if (cached) {
      this.channels.set(cached);
      // Background refresh (non-blocking)
      void this.fetchChannels(type.id, category.id);
      return;
    }

    // No cache — show loading and fetch
    this.isLoadingChannels.set(true);
    await this.fetchChannels(type.id, category.id);
    this.isLoadingChannels.set(false);
  }

  /** Load episodes for a series */
  async loadSeries(seriesId: number): Promise<void> {
    this.isLoadingChannels.set(true);
    try {
      const seasons = await firstValueFrom(
        this.http.get<Season[]>(`/xtream/series/${String(seriesId)}`)
      );
      this.seasons.set(seasons);
    } catch {
      this.error.set('Failed to load series episodes');
    } finally {
      this.isLoadingChannels.set(false);
    }
  }

  /** Go back to type selection (clear category) */
  clearCategory(): void {
    this.selectedCategory.set(null);
    this.channels.set([]);
    this.seasons.set([]);
    this.searchTerm.set('');
  }

  /** Go back to root (clear everything) */
  clearAll(): void {
    this.selectedType.set(null);
    this.selectedCategory.set(null);
    this.channels.set([]);
    this.seasons.set([]);
    this.searchTerm.set('');
  }

  // ─── Private: Fetch ─── //

  private async fetchChannels(typeId: string, categoryId: string): Promise<void> {
    try {
      const channels = await firstValueFrom(
        this.http.get<Channel[]>('/xtream/channels', {
          params: { type: typeId, category_id: categoryId },
        })
      );
      this.channels.set(channels);
      this.saveChannelsToCache(typeId, categoryId, channels);
    } catch {
      this.error.set('Failed to load channels');
    }
  }

  // ─── Private: localStorage Cache ─── //

  private loadTreeFromCache(): void {
    try {
      const raw = localStorage.getItem(CACHE_KEY_TREE);
      if (raw) {
        const cached = JSON.parse(raw) as CacheEntry<ContentTypeNode[]>;
        if (Date.now() - cached.timestamp < CACHE_TTL) {
          this.tree.set(cached.data);
        }
      }
    } catch { /* ignore */ }
  }

  private saveTreeToCache(tree: ContentTypeNode[]): void {
    try {
      const entry: CacheEntry<ContentTypeNode[]> = { data: tree, timestamp: Date.now() };
      localStorage.setItem(CACHE_KEY_TREE, JSON.stringify(entry));
    } catch { /* localStorage full */ }
  }

  private getChannelsFromCache(typeId: string, categoryId: string): Channel[] | null {
    try {
      const raw = localStorage.getItem(`${CACHE_KEY_CHANNELS}:${typeId}:${categoryId}`);
      if (raw) {
        const cached = JSON.parse(raw) as CacheEntry<Channel[]>;
        if (Date.now() - cached.timestamp < CACHE_TTL) {
          return cached.data;
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  private saveChannelsToCache(typeId: string, categoryId: string, channels: Channel[]): void {
    try {
      const entry: CacheEntry<Channel[]> = { data: channels, timestamp: Date.now() };
      localStorage.setItem(`${CACHE_KEY_CHANNELS}:${typeId}:${categoryId}`, JSON.stringify(entry));
    } catch { /* localStorage full */ }
  }
}
