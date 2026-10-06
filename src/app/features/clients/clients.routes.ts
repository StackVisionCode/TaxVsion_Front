import { Routes } from '@angular/router';
import { ClientDirectoryPageComponent } from './components/client-directory-page/client-directory-page.component';
import { accessCanMatch } from '@core/access/access.guard';

export const CLIENTS_ROUTES: Routes = [
  {
    path: '',
    component: ClientDirectoryPageComponent,
    title: 'Clients',
  },
  {
    // Va ANTES de ':id' a propósito: el router de Angular resuelve por orden y, si no,
    // '/clients/import' entraría al perfil de cliente con id = "import".
    path: 'import',
    // La §34 lo marcaba: el enlace se escondía a los no-admin pero la URL abría igual. El guard del
    // shell solo cubre `clients` (customers.view); importar es otra cosa.
    data: { feature: 'clients-import' },
    canMatch: [accessCanMatch],
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
