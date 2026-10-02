import { Routes } from '@angular/router';
import { MailPageComponent } from './components/mail-page/mail-page.component';

export const MAIL_ROUTES: Routes = [
  {
    path: '',
    component: MailPageComponent,
    title: 'Mail',
  },
];
