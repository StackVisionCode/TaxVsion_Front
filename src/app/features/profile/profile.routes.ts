import { Routes } from '@angular/router';

export const PROFILE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/profile-page/profile-page.component').then(m => m.ProfilePageComponent),
    title: 'My Profile',
  },
];
