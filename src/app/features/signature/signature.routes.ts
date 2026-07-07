import { Routes } from '@angular/router';

export const SIGNATURE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/signature-page/signature-page.component').then(m => m.SignaturePageComponent),
    title: 'Signature',
  },
];
