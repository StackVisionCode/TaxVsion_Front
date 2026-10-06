import { Routes } from '@angular/router';
import { DashboardPageComponent } from './components/dashboard-page/dashboard-page.component';
import { DashboardLayoutStore } from './data-access/dashboard-layout.store';

export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    providers: [DashboardLayoutStore],
    component: DashboardPageComponent,
    title: 'Dashboard',
  },
];
