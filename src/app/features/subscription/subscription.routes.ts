import { Routes } from '@angular/router';

export const SUBSCRIPTION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/subscription-page/subscription-page.component').then(m => m.SubscriptionPageComponent),
    title: 'Subscription',
  },
];
