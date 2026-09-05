import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LibraryService } from '../../services/library.service';
import { PlayerService } from '../../services/player.service';
import type { SavedVideo } from '../../models/channel';

/**
 * Library page — shows saved videos with play/export options.
 * Uses httpResource for reactive data fetching (auto-refreshes).
 */
@Component({
  selector: 'app-library',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './library.page.html',
  styleUrl: './library.page.scss',
})
export class LibraryPage {
  protected readonly library = inject(LibraryService);
  protected readonly player = inject(PlayerService);

  protected playVideo(video: SavedVideo): void {
    void this.player.play({ name: video.name ?? 'Unknown', url: video.url, group: 'Saved' });
  }

  protected exportOriginal(video: SavedVideo): void {
    void this.library.exportVideo(video.url, 'original');
  }

  protected exportMp4(video: SavedVideo): void {
    void this.library.exportVideo(video.url, 'mp4');
  }

  protected formatSize(bytes: number): string {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString();
  }
}
