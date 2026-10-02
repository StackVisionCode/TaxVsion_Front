import { Routes } from '@angular/router';
import { SupportPageComponent } from './components/support-page/support-page.component';

export const SUPPORT_ROUTES: Routes = [
  {
    path: '',
    component: SupportPageComponent,
    title: 'Support',
  },
];
