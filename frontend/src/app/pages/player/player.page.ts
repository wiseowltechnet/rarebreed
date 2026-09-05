import { Component, inject, signal, ViewChild, ElementRef, AfterViewInit, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChannelService, type Category, type Channel } from '../../services/channel.service';
import { PlayerService } from '../../services/player.service';
import { SettingsService } from '../../services/settings.service';
import { WatchHistoryService } from '../../services/watch-history.service';
import { FollowService } from '../../services/follow.service';
import { AiService } from '../../services/ai.service';
import { FavoritesService } from '../../services/favorites.service';
import { RecommendationsService } from '../../services/recommendations.service';

declare const Hls: any;

type ViewMode = 'grid' | 'list';

const RECENT_KEY = 'woe-recent';

@Component({
  selector: 'app-player',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './player.page.html',
  styleUrl: './player.page.scss',
})
export class PlayerPage implements AfterViewInit {
  protected readonly channels = inject(ChannelService);
  protected readonly player = inject(PlayerService);
  protected readonly settings = inject(SettingsService);
  protected readonly watchHistory = inject(WatchHistoryService);
  protected readonly follow = inject(FollowService);
  protected readonly ai = inject(AiService);
  protected readonly favorites = inject(FavoritesService);
  protected readonly recs = inject(RecommendationsService);

  /** View mode: grid (posters) or list (compact rows) */
  protected readonly viewMode = signal<ViewMode>('grid');

  /** Whether the player is minimized (collapsed) */
  protected readonly playerMinimized = signal(false);

  /** Recently played channels (from localStorage) */
  protected readonly recentChannels = signal<{ name: string; url: string }[]>([]);

  @ViewChild('videoElement') videoRef!: ElementRef<HTMLVideoElement>;
  private hls: any = null;
  private viewReady = false;

  constructor() {
    this.loadRecent();

    effect(() => {
      const url = this.player.playlistUrl();
      if (url && this.viewReady) {
        this.loadHls(url);
      }
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    const url = this.player.playlistUrl();
    if (url) this.loadHls(url);
  }

  protected onCategoryClick(category: Category): void {
    void this.channels.selectCategory(category);
  }

  protected onChannelClick(channel: Channel): void {
    if (!channel.url && this.channels.selectedType()?.id === 'series') {
      void this.channels.loadSeries(channel.id);
      return;
    }
    const type = this.channels.selectedType()?.id as 'live' | 'vod' | 'series' ?? 'live';
    this.playChannelWithType(channel, type);
  }

  protected playChannel(channel: Channel | { name: string; url: string }): void {
    const type = this.channels.selectedType()?.id as 'live' | 'vod' | 'series' ?? 'series';
    this.playChannelWithType(channel, type);
  }

  private playChannelWithType(channel: { name: string; url: string }, type: 'live' | 'vod' | 'series'): void {
    // Stop previous live-HLS session if switching channels
    void this.player.stopLive();
    void this.player.play({ name: channel.name, url: channel.url, group: '' }, type);
    this.playerMinimized.set(false);
    this.addToRecent(channel);
  }

  protected saveForLater(): void {
    void this.player.saveForLater();
  }

  /** Toggle follow for current series */
  protected toggleFollow(): void {
    const type = this.channels.selectedType();
    if (type?.id !== 'series') return;
    // Get the series from the channel list (first one — they all belong to same series in this view)
    const firstChannel = this.channels.channels()[0];
    if (!firstChannel) return;
    const cat = this.channels.selectedCategory();
    this.follow.toggle({
      seriesId: firstChannel.id,
      name: firstChannel.name.split(' - ')[0] ?? firstChannel.name,
      cover: firstChannel.icon,
      category: cat?.name,
    });
  }

  /** Set sleep timer */
  protected setSleep(type: 'episodes' | 'minutes', value: number): void {
    if (type === 'episodes') this.player.setSleepEpisodes(value);
    else this.player.setSleepMinutes(value);
    this.showSleepMenu.set(false);
  }

  protected readonly showSleepMenu = signal(false);

  /** Ask AI "What's happening?" — captures frame and describes it */
  protected describeFrame(): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    void this.ai.describeFrame(video);
  }

  /**
   * Cast to AirPlay (Safari/WebKit) or Remote Playback (Chrome/Chromecast).
   * Uses the native browser APIs — no SDK needed.
   */
  protected castToAirPlay(): void {
    const video = this.videoRef?.nativeElement as any;
    if (!video) return;

    // 1. Safari/WebKit AirPlay
    if (typeof video.webkitShowPlaybackTargetPicker === 'function') {
      video.webkitShowPlaybackTargetPicker();
      return;
    }

    // 2. Remote Playback API (Chrome — Chromecast, smart TVs)
    if (video.remote && typeof video.remote.prompt === 'function') {
      video.remote.prompt().catch(() => {
        this.player.status.set('No cast devices found');
      });
      return;
    }

    // 3. Fallback: inform user
    this.player.status.set('Cast not available in this browser');
  }

  /** Toggle favorite for a channel */
  protected toggleFavorite(channel: { name: string; url: string; icon?: string }): void {
    const type = this.channels.selectedType()?.id as 'live' | 'vod' | 'series' ?? 'live';
    const favType = type === 'vod' ? 'movie' : type === 'series' ? 'series' : 'live';
    const cat = this.channels.selectedCategory();
    void this.favorites.toggle({
      id: channel.url || channel.name,
      name: channel.name,
      type: favType,
      url: channel.url,
      icon: (channel as any).icon,
      category: cat?.name,
    });
  }

  /** Check if a channel is favorited */
  protected isFav(channel: { url: string; name: string }): boolean {
    return this.favorites.isFavorited(channel.url || channel.name);
  }

  /** Generate a consistent hue from channel name (for gradient placeholders) */
  protected getHue(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return String(Math.abs(hash) % 360);
  }

  /** Handle broken image — hide it and show placeholder */
  protected onImgError(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }

  // ─── Recent channels ─── //

  private addToRecent(channel: { name: string; url: string }): void {
    const recent = this.recentChannels().filter(c => c.url !== channel.url);
    recent.unshift({ name: channel.name, url: channel.url });
    const trimmed = recent.slice(0, 10); // keep last 10
    this.recentChannels.set(trimmed);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed)); } catch { /* */ }
  }

  private loadRecent(): void {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) this.recentChannels.set(JSON.parse(raw) as { name: string; url: string }[]);
    } catch { /* */ }
  }

  // ─── HLS playback ─── //

  private loadHls(url: string): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;

    if (this.hls) { this.hls.destroy(); this.hls = null; }

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const isLive = this.player.contentType() === 'live';
      this.hls = new Hls({
        enableWorker: true,
        // For live: keep 5 min of back-buffer so user can seek/pause
        backBufferLength: isLive ? 300 : 30,
        // For live: start slightly behind live edge for smoother playback
        liveSyncDuration: isLive ? 15 : undefined,
        liveMaxLatencyDuration: isLive ? 30 : undefined,
      });
      this.hls.loadSource(url);
      this.hls.attachMedia(video);
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      this.hls.on(Hls.Events.ERROR, (_e: any, d: any) => {
        if (d.fatal) this.player.status.set('Playback error');
      });
    } else {
      video.src = url;
      video.play().catch(() => {});
    }
  }
}
