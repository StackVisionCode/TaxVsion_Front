import { Routes } from '@angular/router';
import { DashboardLayoutStore } from './data-access/dashboard-layout.store';

export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    providers: [DashboardLayoutStore],
    loadComponent: () =>
      import('./components/dashboard-page/dashboard-page.component').then(m => m.DashboardPageComponent),
    title: 'Dashboard',
  },
];
