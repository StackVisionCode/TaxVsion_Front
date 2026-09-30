import { Routes } from '@angular/router';
import { ReferralsPageComponent } from './components/referrals-page/referrals-page.component';

export const REFERRALS_ROUTES: Routes = [
  {
    path: '',
    component: ReferralsPageComponent,
    title: 'Referrals',
  },
];
