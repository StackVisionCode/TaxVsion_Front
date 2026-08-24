import { Routes } from '@angular/router';
import { guestGuard } from '@core/auth/auth.guard';
import { OnboardingService } from './data-access/onboarding.service';
import { OnboardingStore } from './data-access/onboarding.store';

export const ONBOARDING_ROUTES: Routes = [
  {
    path: '',
    // Service y store viven solo mientras la rama /onboarding está activa.
    providers: [OnboardingService, OnboardingStore],
    children: [
      {
        path: '',
        canActivate: [guestGuard],
        loadComponent: () =>
          import('./components/onboarding-page/onboarding-page.component').then(m => m.OnboardingPageComponent),
        title: 'Empezar',
      },
      // Aterrizajes de Stripe (success/cancelUrl). Sin guestGuard: el comprador es anónimo y
      // una sesión vieja en la misma pestaña no debe robarle la pantalla de vuelta del pago.
      {
        path: 'success',
        loadComponent: () =>
          import('./components/checkout-success/checkout-success.component').then(m => m.CheckoutSuccessComponent),
        title: 'Payment received',
      },
      {
        path: 'cancelled',
        loadComponent: () =>
          import('./components/checkout-cancelled/checkout-cancelled.component').then(
            m => m.CheckoutCancelledComponent,
          ),
        title: 'Checkout cancelled',
      },
    ],
  },
];

/**
 * `/register` — la URL que el backend estampa en el email post-pago
 * (`{RegistrationUrlBase}/register?token=...`), no negociable. Sin `?token=` sirve el wizard
 * de compra. Sin guestGuard: el link del email debe funcionar aunque haya una sesión abierta
 * de otro tenant en el navegador.
 */
export const REGISTER_ROUTES: Routes = [
  {
    path: '',
    providers: [OnboardingService],
    loadComponent: () =>
      import('./components/register-entry/register-entry.component').then(m => m.RegisterEntryComponent),
    title: 'Create your office',
  },
];
