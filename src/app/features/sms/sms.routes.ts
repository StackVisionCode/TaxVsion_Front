import { Routes } from '@angular/router';
import { SmsPageComponent } from './components/sms-page/sms-page.component';

export const SMS_ROUTES: Routes = [
  {
    path: '',
    component: SmsPageComponent,
    title: 'SMS',
  },
];
