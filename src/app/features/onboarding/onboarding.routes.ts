import { Routes } from '@angular/router';
import { guestGuard } from '@core/auth/auth.guard';
import { OnboardingService } from './data-access/onboarding.service';
import { OnboardingStore } from './data-access/onboarding.store';

export const ONBOARDING_ROUTES: Routes = [
  {
    path: '',
    // Service y store viven solo mientras la rama /onboarding está activa.
    providers: [OnboardingService, OnboardingStore],
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./components/onboarding-page/onboarding-page.component').then(m => m.OnboardingPageComponent),
    title: 'Empezar',
  },
];
