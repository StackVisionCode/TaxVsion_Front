import { Routes } from '@angular/router';
import { guestGuard } from '@core/auth/auth.guard';
import { SignupService } from './data-access/signup.service';
import { SignupStore } from './data-access/signup.store';

export const SIGNUP_ROUTES: Routes = [
  {
    path: '',
    // Service y store viven solo mientras la rama /signup está activa.
    providers: [SignupService, SignupStore],
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./components/signup-page/signup-page.component').then(m => m.SignupPageComponent),
    title: 'Crear cuenta',
  },
];
