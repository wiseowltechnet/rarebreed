import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/** A favorite entry from the backend */
export interface Favorite {
  readonly id: string;
  readonly name: string;
  readonly type: 'live' | 'movie' | 'series';
  readonly url?: string;
  readonly icon?: string;
  readonly category?: string;
  readonly seriesId?: number;
  readonly addedAt: number;
}

/**
 * Favorites Service — manages starred live channels, series, and movies.
 *
 * - Server-side persistence (survives browser cache clear)
 * - Exposes filtered signals for each content type
 * - Toggle pattern: call toggle() and it adds or removes
 *
 * Like: Spring @Service with @Cacheable + repository pattern
 */
@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly http = inject(HttpClient);

  /** All favorites (loaded from server) */
  private readonly all = signal<Favorite[]>([]);

  /** Favorited live channels */
  readonly live = computed(() => this.all().filter(f => f.type === 'live'));

  /** Favorited movies */
  readonly movies = computed(() => this.all().filter(f => f.type === 'movie'));

  /** Favorited series */
  readonly series = computed(() => this.all().filter(f => f.type === 'series'));

  /** Total favorites count */
  readonly count = computed(() => this.all().length);

  /** Set of favorited IDs for quick lookup */
  private readonly idSet = computed(() => new Set(this.all().map(f => f.id)));

  constructor() {
    void this.load();
  }

  /** Check if an item is favorited (instant, local) */
  isFavorited(id: string): boolean {
    return this.idSet().has(id);
  }

  /**
   * Toggle favorite state — adds if not favorited, removes if already is.
   * Returns the new state (true = now favorited).
   */
  async toggle(item: {
    id: string;
    name: string;
    type: 'live' | 'movie' | 'series';
    url?: string;
    icon?: string;
    category?: string;
    seriesId?: number;
  }): Promise<boolean> {
    if (this.isFavorited(item.id)) {
      await this.remove(item.id);
      return false;
    } else {
      await this.add(item);
      return true;
    }
  }

  /** Add a favorite */
  async add(item: {
    id: string;
    name: string;
    type: 'live' | 'movie' | 'series';
    url?: string;
    icon?: string;
    category?: string;
    seriesId?: number;
  }): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/favorites', item));
      // Optimistic update
      this.all.update(list => [{
        ...item,
        addedAt: Date.now(),
      }, ...list]);
    } catch {
      // Revert on failure — reload from server
      void this.load();
    }
  }

  /** Remove a favorite by ID */
  async remove(id: string): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(`/favorites/${encodeURIComponent(id)}`));
      // Optimistic update
      this.all.update(list => list.filter(f => f.id !== id));
    } catch {
      void this.load();
    }
  }

  /** Load all favorites from server */
  private async load(): Promise<void> {
    try {
      const favorites = await firstValueFrom(
        this.http.get<Favorite[]>('/favorites')
      );
      this.all.set(favorites);
    } catch {
      // Server unavailable — keep current state
    }
  }

  /** Force reload from server (call after login, etc.) */
  async refresh(): Promise<void> {
    await this.load();
  }
}
