import { Routes } from '@angular/router';

export const MEETINGS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/meetings-page/meetings-page.component').then(m => m.MeetingsPageComponent),
    title: 'Meetings',
  },
];
