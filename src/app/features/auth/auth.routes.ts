import { Routes } from '@angular/router';
import { guestGuard, mfaSetupGuard, mfaVerifyGuard } from '@core/auth/auth.guard';

export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./components/login-page/login-page.component').then(m => m.LoginPageComponent),
    title: 'Sign In',
  },
  {
    path: 'login/verify',
    canActivate: [mfaVerifyGuard],
    loadComponent: () =>
      import('./components/mfa-verify-page/mfa-verify-page.component').then(m => m.MfaVerifyPageComponent),
    title: 'Two-step verification',
  },
  {
    path: 'login/setup-mfa',
    canActivate: [mfaSetupGuard],
    loadComponent: () =>
      import('./components/mfa-setup-page/mfa-setup-page.component').then(m => m.MfaSetupPageComponent),
    title: 'Set up two-step verification',
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./components/register-page/register-page.component').then(m => m.RegisterPageComponent),
    title: 'Create Account',
  },
  {
    path: 'forgot-password',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./components/forgot-password-page/forgot-password-page.component').then(
        m => m.ForgotPasswordPageComponent,
      ),
    title: 'Reset Password',
  },
];
