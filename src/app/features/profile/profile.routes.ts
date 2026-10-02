import { Routes } from '@angular/router';
import { ProfilePageComponent } from './components/profile-page/profile-page.component';

export const PROFILE_ROUTES: Routes = [
  {
    path: '',
    component: ProfilePageComponent,
    title: 'My Profile',
  },
];
