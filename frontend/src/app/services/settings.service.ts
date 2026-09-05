import { Injectable, signal, effect } from '@angular/core';

export type Theme = 'dark' | 'light';

export interface AppSettings {
  playlistUrl: string;
  theme: Theme;
  autoLoadPlaylist: boolean;
  playerVolume: number;
}

const STORAGE_KEY = 'woe-settings';

const DEFAULTS: AppSettings = {
  playlistUrl: '',
  theme: 'dark',
  autoLoadPlaylist: true,
  playerVolume: 80,
};

/**
 * Settings service — persists user preferences to localStorage.
 * Reactive via signals — UI updates instantly when settings change.
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly playlistUrl = signal(DEFAULTS.playlistUrl);
  readonly theme = signal<Theme>(DEFAULTS.theme);
  readonly autoLoadPlaylist = signal(DEFAULTS.autoLoadPlaylist);
  readonly playerVolume = signal(DEFAULTS.playerVolume);

  /** Whether settings panel is open */
  readonly isOpen = signal(false);

  constructor() {
    this.load();

    // Auto-save whenever any setting changes
    effect(() => {
      const settings: AppSettings = {
        playlistUrl: this.playlistUrl(),
        theme: this.theme(),
        autoLoadPlaylist: this.autoLoadPlaylist(),
        playerVolume: this.playerVolume(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    });

    // Apply theme to document
    effect(() => {
      document.documentElement.setAttribute('data-theme', this.theme());
    });
  }

  toggle(): void {
    this.isOpen.update(v => !v);
  }

  toggleTheme(): void {
    this.theme.update(t => t === 'dark' ? 'light' : 'dark');
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<AppSettings>;
        if (saved.playlistUrl) this.playlistUrl.set(saved.playlistUrl);
        if (saved.theme) this.theme.set(saved.theme);
        if (saved.autoLoadPlaylist !== undefined) this.autoLoadPlaylist.set(saved.autoLoadPlaylist);
        if (saved.playerVolume !== undefined) this.playerVolume.set(saved.playerVolume);
      }
    } catch {
      // corrupted localStorage — use defaults
    }
  }
}
