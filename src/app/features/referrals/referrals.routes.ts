import { Routes } from '@angular/router';

export const REFERRALS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/referrals-page/referrals-page.component').then(m => m.ReferralsPageComponent),
    title: 'Referrals',
  },
];
