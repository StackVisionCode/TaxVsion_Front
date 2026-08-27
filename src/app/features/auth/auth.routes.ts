import { Routes } from '@angular/router';
import { guestGuard, mfaSetupGuard, mfaVerifyGuard } from '@core/auth/auth.guard';
import { officeGuard } from '@core/auth/office.guard';
import { tenantSlugFromHost } from '@core/config/api-config.service';

export const AUTH_ROUTES: Routes = [
  {
    // En el subdominio de una oficina (manfer.taxproffice.com) va el login directo. En app.* (sin
    // slug de Host) y en dev va el login CENTRAL: email+password → descubre las oficinas → redirige
    // al subdominio a canjear el vale. El guestGuard/officeGuard aplican a ambos por igual.
    path: 'login',
    canActivate: [guestGuard, officeGuard],
    loadComponent: () =>
      tenantSlugFromHost() === null
        ? import('./components/central-login-page/central-login-page.component').then(
            m => m.CentralLoginPageComponent,
          )
        : import('./components/login-page/login-page.component').then(m => m.LoginPageComponent),
    title: 'Sign In',
  },
  {
    // Entrada central del CLIENTE (portal). Misma página/lógica que /login pero el destino tras
    // autenticar es el portal (`/portal/client/auth/continue`), no el CRM. Vive en app.* porque el
    // portal solo se sirve en el subdominio; los clientes llegan aquí por su invitación.
    path: 'client',
    canActivate: [guestGuard],
    data: { portal: true },
    loadComponent: () =>
      import('./components/central-login-page/central-login-page.component').then(
        m => m.CentralLoginPageComponent,
      ),
    title: 'Sign In',
  },
  {
    // Gate de Términos del staff: el authGuard desvía aquí cuando el tenant no aceptó la versión
    // vigente del ToS (se publicó una nueva post-onboarding). Sin guard propio, pero requiere sesión.
    path: 'terms',
    loadComponent: () =>
      import('./components/terms-page/terms-page.component').then(m => m.TermsPageComponent),
    title: 'Terms & Privacy',
  },
  {
    // Aterrizaje del login central en el subdominio: canjea ?ticket= por la sesión. Sin guard: es
    // donde nace la sesión y debe correr siempre.
    path: 'auth/continue',
    loadComponent: () =>
      import('./components/auth-continue-page/auth-continue-page.component').then(
        m => m.AuthContinuePageComponent,
      ),
    title: 'Signing in',
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
    canActivate: [guestGuard, officeGuard],
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
    // Subdominio no registrado (lo bloquea el TenantHostGuard del Gateway): mensaje plano,
    // ya no se redirige a find-office. Sin guard: debe verse siempre.
    path: 'office-unavailable',
    loadComponent: () =>
      import('@core/auth/office-unavailable.component').then(m => m.OfficeUnavailableComponent),
    title: 'Office unavailable',
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
