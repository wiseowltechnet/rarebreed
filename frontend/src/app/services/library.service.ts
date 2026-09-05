import { Injectable, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import type { SavedVideo } from '../models/channel';
import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/**
 * Library service — manages saved videos (offline library).
 * Uses httpResource for reactive data fetching.
 */
@Injectable({ providedIn: 'root' })
export class LibraryService {
  private readonly http = inject(HttpClient);

  /** Reactive resource — auto-fetches saved videos */
  readonly savedVideos = httpResource<SavedVideo[]>(() => ({
    url: '/api/library',
  }), { defaultValue: [] });

  /** Export status */
  readonly exportStatus = signal('');

  /** Reload the library (after saving a new video) */
  reload(): void {
    this.savedVideos.reload();
  }

  /** Export a video — original format or transcode to MP4 */
  async exportVideo(url: string, format: 'original' | 'mp4' | 'mp4-720p'): Promise<string> {
    try {
      const result = await firstValueFrom(
        this.http.post<{ status: string; outputPath?: string; error?: string }>(
          '/api/export',
          { url, format }
        )
      );

      if (result.status === 'done' && result.outputPath) {
        this.exportStatus.set(`Exported to: ${result.outputPath}`);
        return result.outputPath;
      }
      this.exportStatus.set(`Export failed: ${result.error ?? 'unknown'}`);
      return '';
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      this.exportStatus.set(msg);
      return '';
    }
  }
}
