export interface Channel {
  readonly name: string;
  readonly url: string;
  readonly group: string;
}

export interface SavedVideo {
  readonly url: string;
  readonly name?: string;
  readonly size: number;
  readonly contentType: string;
  readonly createdAt: string;
  readonly lastAccessedAt: string;
  readonly saved: boolean;
}

export interface TranscodeSession {
  readonly id: string;
  readonly playlist: string;
  readonly status: 'ready' | 'transcoding';
}

export interface LoginCredentials {
  readonly username: string;
  readonly password: string;
}

export interface HealthStatus {
  readonly status: 'up' | 'down';
  readonly uptime: number;
  readonly timestamp: string;
  readonly version: string;
  readonly memoryUsage: {
    readonly heapUsedMB: number;
    readonly heapTotalMB: number;
  };
}
