import { Routes } from '@angular/router';

export const NOTIFICATIONS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/notifications-page/notifications-page.component').then(
        m => m.NotificationsPageComponent,
      ),
    title: 'Notifications',
  },
];
