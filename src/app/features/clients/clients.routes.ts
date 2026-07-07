import { Routes } from '@angular/router';

export const CLIENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/client-directory-page/client-directory-page.component').then(
        m => m.ClientDirectoryPageComponent,
      ),
    title: 'Clients',
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./components/client-profile-page/client-profile-page.component').then(
        m => m.ClientProfilePageComponent,
      ),
    title: 'Client Profile',
  },
];
