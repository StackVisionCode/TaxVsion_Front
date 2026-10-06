import { Routes } from '@angular/router';
import { NotificationsPageComponent } from './components/notifications-page/notifications-page.component';

export const NOTIFICATIONS_ROUTES: Routes = [
  {
    path: '',
    component: NotificationsPageComponent,
    title: 'Notifications',
  },
];
