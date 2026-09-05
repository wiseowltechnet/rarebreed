import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then(m => m.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/player/player.page').then(m => m.PlayerPage),
  },
  {
    path: 'library',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/library/library.page').then(m => m.LibraryPage),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
