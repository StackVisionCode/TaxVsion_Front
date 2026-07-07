import { Routes } from '@angular/router';

export const DOCUMENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/documents-page/documents-page.component').then(m => m.DocumentsPageComponent),
    title: 'Documents',
  },
];
