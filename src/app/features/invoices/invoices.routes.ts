import { Routes } from '@angular/router';

export const INVOICES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/invoices-page/invoices-page.component').then(m => m.InvoicesPageComponent),
    title: 'Invoices',
  },
];
