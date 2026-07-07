import { Routes } from '@angular/router';

export const CAMPAIGNS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/campaigns-page/campaigns-page.component').then(m => m.CampaignsPageComponent),
    title: 'Campaigns',
  },
];
