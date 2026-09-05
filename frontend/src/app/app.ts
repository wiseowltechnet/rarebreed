import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavbarComponent } from './components/navbar/navbar.component';
import { SettingsPanelComponent } from './components/settings-panel/settings-panel.component';
import { AuthService } from './services/auth.service';

@Component({
  imports: [RouterOutlet, NavbarComponent, SettingsPanelComponent],
  selector: 'app-root',
  template: `
    @if (auth.isAuthenticated()) {
      <app-navbar />
    }
    <main>
      <router-outlet />
    </main>
    <app-settings-panel />
  `,
  styles: `
    main {
      min-height: calc(100vh - 56px);
    }
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
}
