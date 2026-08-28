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
    // Va ANTES de ':id' a propósito: el router de Angular resuelve por orden y, si no,
    // '/clients/import' entraría al perfil de cliente con id = "import".
    path: 'import',
    loadComponent: () =>
      import('./components/client-import-page/client-import-page.component').then(
        m => m.ClientImportPageComponent,
      ),
    title: 'Import Clients',
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
