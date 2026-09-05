import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/**
 * AI Service — interfaces with local Ollama for vision and text features.
 *
 * Features:
 * - "What's happening?" — captures video frame, AI describes the scene
 * - Smart search — natural language content filtering
 * - Show summaries — AI-generated 1-2 sentence descriptions
 *
 * All processing is LOCAL (Ollama) — no data leaves your machine.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly http = inject(HttpClient);

  /** Whether Ollama is available */
  readonly available = signal(false);

  /** Whether vision model (llava) is loaded */
  readonly hasVision = signal(false);

  /** Current AI description (from "What's happening?") */
  readonly description = signal('');

  /** Whether AI is currently processing */
  readonly isProcessing = signal(false);

  constructor() {
    void this.checkStatus();
  }

  /** Check if Ollama is running and what models are available */
  async checkStatus(): Promise<void> {
    try {
      const status = await firstValueFrom(
        this.http.get<{ available: boolean; hasVision: boolean }>('/ai/status')
      );
      this.available.set(status.available);
      this.hasVision.set(status.hasVision);
    } catch {
      this.available.set(false);
    }
  }

  /**
   * "What's happening?" — captures current video frame and sends to AI vision model.
   * Returns a description of the scene.
   */
  async describeFrame(videoElement: HTMLVideoElement): Promise<string> {
    if (!this.hasVision()) {
      return 'Vision model (llava) not available. Run: ollama pull llava:13b';
    }

    this.isProcessing.set(true);
    this.description.set('Analyzing frame...');

    try {
      // Capture frame from video element as base64
      const canvas = document.createElement('canvas');
      canvas.width = videoElement.videoWidth || 640;
      canvas.height = videoElement.videoHeight || 360;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 'Canvas not supported';

      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1] ?? '';

      // Send to AI
      const result = await firstValueFrom(
        this.http.post<{ description: string }>('/ai/describe', { image: base64 })
      );

      this.description.set(result.description);
      return result.description;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI analysis failed';
      this.description.set(msg);
      return msg;
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Smart search — use AI to find channels matching a natural language query.
   * Example: "find me reality shows about cooking"
   */
  async smartSearch(query: string, channelNames: string[]): Promise<string[]> {
    if (!this.available()) return [];

    this.isProcessing.set(true);
    try {
      const result = await firstValueFrom(
        this.http.post<{ results: string[] }>('/ai/search', { query, channels: channelNames })
      );
      return result.results;
    } catch {
      return [];
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Get an AI-generated summary for a show/movie.
   */
  async summarize(name: string, overview?: string): Promise<string> {
    if (!this.available()) return '';

    try {
      const result = await firstValueFrom(
        this.http.post<{ summary: string }>('/ai/summarize', { name, overview })
      );
      return result.summary;
    } catch {
      return '';
    }
  }

  // ─── AI Closed Captions ─── //

  /** Whether CC mode is active */
  readonly captionsEnabled = signal(false);

  /** Current caption text (rolling, updates every ~10s) */
  readonly caption = signal('');

  /** Rolling caption history (last 5) */
  readonly captionHistory = signal<string[]>([]);

  /** Reference to the video element for frame capture */
  private videoRef: HTMLVideoElement | null = null;

  /** Interval timer for captioning */
  private captionTimer: ReturnType<typeof setInterval> | null = null;

  /** Whether a caption request is in-flight (prevent overlap) */
  private captionInFlight = false;

  /** Exposed signal: whether AI is generating a caption (for UI indicator) */
  readonly captionGenerating = signal(false);

  /**
   * Start AI closed captioning — captures a frame every 10s and
   * sends to Ollama llava for a short description.
   *
   * @param videoElement - The HTML video element to capture frames from
   */
  startCaptions(videoElement: HTMLVideoElement): void {
    if (!this.hasVision()) return;

    this.videoRef = videoElement;
    this.captionsEnabled.set(true);
    this.caption.set('AI Captions starting...');

    // Capture first frame immediately
    void this.captureAndCaption();

    // Then every 10 seconds
    this.captionTimer = setInterval(() => {
      void this.captureAndCaption();
    }, 10_000);
  }

  /** Stop AI closed captioning */
  stopCaptions(): void {
    this.captionsEnabled.set(false);
    this.caption.set('');
    this.captionHistory.set([]);
    this.videoRef = null;

    if (this.captionTimer) {
      clearInterval(this.captionTimer);
      this.captionTimer = null;
    }
  }

  /** Toggle captions on/off */
  toggleCaptions(videoElement: HTMLVideoElement): void {
    if (this.captionsEnabled()) {
      this.stopCaptions();
    } else {
      this.startCaptions(videoElement);
    }
  }

  /** Capture a frame and get AI caption */
  private async captureAndCaption(): Promise<void> {
    if (this.captionInFlight || !this.videoRef) return;
    if (this.videoRef.paused || this.videoRef.ended) return;

    this.captionInFlight = true;
    this.captionGenerating.set(true);

    try {
      const canvas = document.createElement('canvas');
      // Use lower resolution for speed (caption doesn't need 1080p)
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(this.videoRef, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1] ?? '';

      const result = await firstValueFrom(
        this.http.post<{ caption: string }>('/ai/caption', { image: base64 })
      );

      if (result.caption && this.captionsEnabled()) {
        this.caption.set(result.caption);
        this.captionHistory.update(history => {
          const updated = [result.caption, ...history];
          return updated.slice(0, 5); // keep last 5
        });
      }
    } catch {
      // Silently skip — don't interrupt playback for CC failures
    } finally {
      this.captionInFlight = false;
      this.captionGenerating.set(false);
    }
  }
}
