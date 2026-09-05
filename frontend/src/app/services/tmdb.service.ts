import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/** TMDB movie/series search result */
export interface TmdbResult {
  readonly id: number;
  readonly title?: string;        // movies
  readonly name?: string;         // series
  readonly vote_average: number;  // rating 0-10
  readonly vote_count: number;
  readonly overview: string;
  readonly poster_path: string | null;
  readonly release_date?: string;
  readonly first_air_date?: string;
  readonly genre_ids: number[];
}

interface TmdbSearchResponse {
  readonly results: TmdbResult[];
  readonly total_results: number;
}

const CACHE_KEY = 'woe-tmdb-cache';

/**
 * TMDB Service — fetches ratings, descriptions, and recommendations.
 *
 * Uses TMDB's free API (requires API key in settings/env).
 * Caches results in localStorage to avoid repeated API calls.
 *
 * In future: used for recommendation algorithms.
 */
@Injectable({ providedIn: 'root' })
export class TmdbService {
  private readonly http = inject(HttpClient);
  private cache = new Map<string, { data: TmdbResult; timestamp: number }>();
  private readonly CACHE_TTL = 24 * 60 * 60_000; // 24 hours

  constructor() {
    this.loadCache();
  }

  /**
   * Get TMDB rating for a movie/series by name.
   * Returns rating 0-10 (or null if not found).
   */
  async getRating(name: string, type: 'movie' | 'tv' = 'movie'): Promise<number | null> {
    const result = await this.search(name, type);
    return result?.vote_average ?? null;
  }

  /**
   * Search TMDB for a movie or TV series.
   * Returns the best match with rating, overview, etc.
   */
  async search(name: string, type: 'movie' | 'tv' = 'movie'): Promise<TmdbResult | null> {
    // Check local cache first
    const cacheKey = `${type}:${name.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    // Clean the name (remove year, season info)
    const cleanName = this.cleanTitle(name);

    try {
      // Call our backend proxy (avoids exposing TMDB API key to frontend)
      const response = await firstValueFrom(
        this.http.get<TmdbSearchResponse>('/api/tmdb/search', {
          params: { query: cleanName, type },
        })
      );

      if (response.results.length > 0) {
        const best = response.results[0];
        this.cache.set(cacheKey, { data: best, timestamp: Date.now() });
        this.saveCache();
        return best;
      }
    } catch {
      // TMDB unavailable — return null (non-critical feature)
    }

    return null;
  }

  /**
   * Get display rating string (e.g. "⭐ 8.2")
   */
  formatRating(rating: number | null): string {
    if (rating === null || rating === 0) return '';
    return `⭐ ${rating.toFixed(1)}`;
  }

  /**
   * Clean title for search (remove year, season markers, etc.)
   */
  private cleanTitle(name: string): string {
    return name
      .replace(/\(\d{4}\)/, '')           // remove (2024)
      .replace(/\s*S\d+E\d+.*/, '')       // remove S01E01...
      .replace(/\s*-\s*S\d+.*/, '')       // remove - S01...
      .replace(/\s*Season\s*\d+.*/, '')   // remove Season 1...
      .replace(/\s*\d{4}$/, '')           // remove trailing year
      .trim();
  }

  // ─── localStorage cache ─── //

  private saveCache(): void {
    try {
      const entries = [...this.cache.entries()].slice(-200); // keep last 200
      localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
    } catch { /* */ }
  }

  private loadCache(): void {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const entries = JSON.parse(raw) as [string, { data: TmdbResult; timestamp: number }][];
        this.cache = new Map(entries);
      }
    } catch { /* */ }
  }
}
