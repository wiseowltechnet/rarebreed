import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

/**
 * Login page — Wise Owl Entertainment branded login.
 * Uses signals for reactive form state (Angular 22 pattern).
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  protected readonly auth = inject(AuthService);

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly isSubmitting = signal(false);

  protected async onSubmit(): Promise<void> {
    this.isSubmitting.set(true);
    await this.auth.login({
      username: this.username(),
      password: this.password(),
    });
    this.isSubmitting.set(false);
  }
}
