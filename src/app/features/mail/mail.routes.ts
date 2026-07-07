import { Routes } from '@angular/router';

export const MAIL_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/mail-page/mail-page.component').then(m => m.MailPageComponent),
    title: 'Mail',
  },
];
