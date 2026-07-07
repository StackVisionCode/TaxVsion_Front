import { Routes } from '@angular/router';

export const STORAGE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/storage-page/storage-page.component').then(m => m.StoragePageComponent),
    title: 'Storage',
  },
];
