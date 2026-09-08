import { Routes } from '@angular/router';
import { BillingStore } from './data-access/billing.store';

export const BILLING_ROUTES: Routes = [
  {
    path: '',
    // El store vive solo mientras se está en /billing: al salir se descarta el listado cargado y
    // los filtros. `BillingService` es `providedIn: 'root'` porque no guarda estado.
    providers: [BillingStore],
    loadComponent: () =>
      import('./components/billing-page/billing-page.component').then(m => m.BillingPageComponent),
    title: 'Invoices',
  },
];
