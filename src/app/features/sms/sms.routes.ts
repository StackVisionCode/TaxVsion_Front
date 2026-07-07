import { Routes } from '@angular/router';

export const SMS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/sms-page/sms-page.component').then(m => m.SmsPageComponent),
    title: 'SMS',
  },
];
