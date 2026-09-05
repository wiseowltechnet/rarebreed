import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { WatchHistoryService } from './watch-history.service';
import { FavoritesService } from './favorites.service';

/** A recommendation from TMDB */
export interface Recommendation {
  readonly id: number;
  readonly title: string;
  readonly overview: string;
  readonly rating: number;
  readonly poster: string | null;
  readonly type: 'movie' | 'tv';
  readonly reason: string;
}

/**
 * Recommendations Service — "Because you watched X, try Y"
 *
 * Pulls from watch history + favorites, sends titles to backend,
 * backend queries TMDB recommendations API, returns ranked results.
 *
 * Like: Netflix's recommendation engine, but using TMDB's built-in
 * collaborative filtering (based on what other users who liked X also liked).
 */
@Injectable({ providedIn: 'root' })
export class RecommendationsService {
  private readonly http = inject(HttpClient);
  private readonly watchHistory = inject(WatchHistoryService);
  private readonly favorites = inject(FavoritesService);

  /** All recommendations */
  readonly items = signal<Recommendation[]>([]);

  /** Whether we're loading recommendations */
  readonly isLoading = signal(false);

  /** Top 10 recommendations (for home page) */
  readonly top = computed(() => this.items().slice(0, 10));

  /** Whether we have recommendations to show */
  readonly hasRecs = computed(() => this.items().length > 0);

  constructor() {
    // Load recommendations after a short delay (let watch history + favs load first)
    setTimeout(() => void this.refresh(), 5000);
  }

  /**
   * Refresh recommendations based on current watch history + favorites.
   * Sends the most recent/important titles to the backend.
   */
  async refresh(): Promise<void> {
    // Collect titles from watch history (completed) + favorites (series/movies)
    const titles = new Set<string>();

    // From watch history — recently completed episodes
    for (const entry of this.watchHistory.entries().slice(0, 10)) {
      const name = entry.seriesName ?? entry.name;
      titles.add(name);
    }

    // From favorites — series and movies
    for (const fav of this.favorites.series()) {
      titles.add(fav.name);
    }
    for (const fav of this.favorites.movies()) {
      titles.add(fav.name);
    }

    if (titles.size === 0) return;

    this.isLoading.set(true);

    try {
      const result = await firstValueFrom(
        this.http.post<{ recommendations: Recommendation[] }>('/api/tmdb/recommendations', {
          titles: [...titles].slice(0, 5),
        })
      );
      this.items.set(result.recommendations);
    } catch {
      // TMDB unavailable — no recommendations (non-critical)
    } finally {
      this.isLoading.set(false);
    }
  }
}
