import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { LoginCredentials } from '../models/channel';

/**
 * Authentication service — manages login state.
 * Like Spring Security's AuthenticationManager.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  /** Whether the user is logged in (reactive signal) */
  readonly isAuthenticated = signal(false);

  /** Login error message */
  readonly error = signal('');

  /**
   * Attempt login with credentials.
   * On success: sets auth cookie, navigates to player.
   * On failure: sets error message.
   */
  async login(credentials: LoginCredentials): Promise<boolean> {
    this.error.set('');
    try {
      await firstValueFrom(
        this.http.post('/auth/login', credentials)
      );
      this.isAuthenticated.set(true);
      void this.router.navigate(['/']);
      return true;
    } catch {
      this.error.set('Invalid credentials');
      return false;
    }
  }

  /** Logout — clears cookie and redirects to login */
  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.get('/auth/logout'));
    } catch {
      // Redirect might cause an error — that's fine
    }
    this.isAuthenticated.set(false);
    void this.router.navigate(['/login']);
  }
}
