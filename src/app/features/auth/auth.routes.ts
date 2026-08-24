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
  // OJO: aquí NO va ninguna ruta 'register'. AUTH_ROUTES se monta en `path: ''`
  // (app.routes.ts) ANTES del `path: 'register'` real, así que un hijo 'register'
  // eclipsaba al alta de verdad — el comprador que venía del email post-pago
  // ({RegistrationUrlBase}/register?token=…) aterrizaba en un formulario simulado
  // que anunciaba "Account created!" sin crear tenant ni cuenta.
  // El alta real vive en features/onboarding (REGISTER_ROUTES → RegisterEntryComponent).
  {
    path: 'forgot-password',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./components/forgot-password-page/forgot-password-page.component').then(
        m => m.ForgotPasswordPageComponent,
      ),
    title: 'Reset Password',
  },
  {
    path: 'find-office',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./components/find-office-page/find-office-page.component').then(
        m => m.FindOfficePageComponent,
      ),
    title: 'Find your office',
  },
  {
    // Ruta que recibe el link emailado por POST /auth/password/forgot (?token=...).
    // Sin guestGuard a propósito: el link puede llegar con una sesión previa todavía
    // viva en el navegador (otro dispositivo, sesión vieja) y el reset debe poder
    // completarse igual.
    path: 'reset-password',
    loadComponent: () =>
      import('./components/reset-password-page/reset-password-page.component').then(
        m => m.ResetPasswordPageComponent,
      ),
    title: 'Set New Password',
  },
];
