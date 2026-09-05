import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Channel, TranscodeSession } from '../models/channel';

/**
 * Player service — handles video playback via server-side transcoding.
 * Sends video URL to backend which transcodes to HLS for browser playback.
 */
@Injectable({ providedIn: 'root' })
export class PlayerService {
  private readonly http = inject(HttpClient);

  /** Currently playing channel */
  readonly currentChannel = signal<Channel | null>(null);

  /** Content type of what's playing (live = no save) */
  readonly contentType = signal<'live' | 'vod' | 'series' | null>(null);

  /** Whether the current content can be saved (not live) */
  readonly canSave = signal(false);

  /** HLS playlist URL (set after transcode starts) */
  readonly playlistUrl = signal<string | null>(null);

  /** Player status message */
  readonly status = signal('Ready');

  /** Whether transcoding is in progress */
  readonly isTranscoding = signal(false);

  /**
   * Play a channel — for live TV uses HLS live buffer (5min window),
   * for VOD/series uses server-side transcode.
   * @param channel - Channel to play
   * @param type - Content type: 'live' (buffered HLS), 'vod', 'series'
   */
  async play(channel: Channel, type: 'live' | 'vod' | 'series' = 'live'): Promise<void> {
    this.currentChannel.set(channel);
    this.contentType.set(type);
    this.canSave.set(type !== 'live');
    this.playlistUrl.set(null);
    this.isTranscoding.set(true);
    this.status.set(type === 'live' ? 'Starting live buffer...' : 'Starting transcode...');

    try {
      if (type === 'live') {
        // Live TV: use HLS live buffer (no re-encoding, 5-min rolling window)
        const session = await firstValueFrom(
          this.http.post<{ sessionId: string; playlist: string; reused: boolean }>(
            '/live-hls/start',
            { url: channel.url }
          )
        );
        this.playlistUrl.set(session.playlist);
        this.liveSessionId.set(session.sessionId);
        this.status.set(`Live: ${channel.name} (5 min buffer)`);
      } else {
        // VOD/Series: transcode to HLS
        const session = await firstValueFrom(
          this.http.post<TranscodeSession>('/transcode', { url: channel.url })
        );
        this.playlistUrl.set(session.playlist);
        this.status.set(`Playing: ${channel.name}`);
      }
    } catch {
      this.status.set('Playback failed — trying mpv fallback...');
      try {
        await firstValueFrom(
          this.http.post('/api/play', { url: channel.url })
        );
        this.status.set(`Playing in mpv: ${channel.name}`);
      } catch {
        this.status.set('Playback failed');
      }
    } finally {
      this.isTranscoding.set(false);
    }
  }

  /** Active live-HLS session ID (for cleanup on channel switch) */
  readonly liveSessionId = signal<string | null>(null);

  /** Stop the active live-HLS session (call when switching channels or leaving player) */
  async stopLive(): Promise<void> {
    const id = this.liveSessionId();
    if (!id) return;
    try {
      await firstValueFrom(this.http.post(`/live-hls/${id}/stop`, {}));
    } catch { /* best-effort */ }
    this.liveSessionId.set(null);
  }

  /** Save current video for later */
  async saveForLater(): Promise<void> {
    const channel = this.currentChannel();
    if (!channel) return;

    try {
      await firstValueFrom(
        this.http.post('/api/save', { url: channel.url, name: channel.name })
      );
      this.status.set(`Saved: ${channel.name}`);
    } catch {
      this.status.set('Save failed');
    }
  }

  // ─── Auto-Play ─── //

  /** Whether auto-play next episode is enabled */
  readonly autoPlayEnabled = signal(true);

  /** Episode playlist for auto-play (set when playing a series) */
  readonly playlist = signal<{ name: string; url: string }[]>([]);

  /** Current index in the playlist */
  readonly playlistIndex = signal(-1);

  /** Sleep timer: episodes remaining (0 = disabled) */
  readonly sleepEpisodes = signal(0);

  /** Sleep timer: minutes remaining (0 = disabled) */
  readonly sleepMinutes = signal(0);

  private sleepTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Set the episode playlist for auto-play (called when entering a series season).
   */
  setPlaylist(episodes: { name: string; url: string }[], startIndex: number): void {
    this.playlist.set(episodes);
    this.playlistIndex.set(startIndex);
  }

  /**
   * Called when current episode ends — plays next if auto-play is on.
   * Returns true if next episode was started.
   */
  playNext(): boolean {
    if (!this.autoPlayEnabled()) return false;

    // Check sleep timer (episodes)
    if (this.sleepEpisodes() > 0) {
      this.sleepEpisodes.update(v => v - 1);
      if (this.sleepEpisodes() <= 0) {
        this.status.set('Sleep timer: stopping playback');
        return false;
      }
    }

    const pl = this.playlist();
    const idx = this.playlistIndex();

    if (idx < 0 || idx >= pl.length - 1) return false; // no next episode

    const next = pl[idx + 1];
    if (!next) return false;

    this.playlistIndex.set(idx + 1);
    void this.play({ name: next.name, url: next.url, group: '' }, this.contentType() ?? 'series');
    this.status.set(`Auto-playing: ${next.name}`);
    return true;
  }

  /**
   * Set sleep timer by episode count.
   */
  setSleepEpisodes(count: number): void {
    this.sleepEpisodes.set(count);
    this.status.set(`Sleep timer: ${String(count)} episodes remaining`);
  }

  /**
   * Set sleep timer by minutes.
   */
  setSleepMinutes(minutes: number): void {
    this.sleepMinutes.set(minutes);
    if (this.sleepTimeout) clearTimeout(this.sleepTimeout);
    this.sleepTimeout = setTimeout(() => {
      this.autoPlayEnabled.set(false);
      this.status.set('Sleep timer: stopped');
      this.sleepMinutes.set(0);
    }, minutes * 60_000);
    this.status.set(`Sleep timer: ${String(minutes)} minutes`);
  }

  /** Cancel sleep timer */
  cancelSleep(): void {
    this.sleepEpisodes.set(0);
    this.sleepMinutes.set(0);
    if (this.sleepTimeout) {
      clearTimeout(this.sleepTimeout);
      this.sleepTimeout = null;
    }
  }
}
