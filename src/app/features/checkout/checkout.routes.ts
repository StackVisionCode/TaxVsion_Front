import { Routes } from '@angular/router';
import { CheckoutService } from './data-access/checkout.service';
import { CheckoutStore } from './data-access/checkout.store';

export const CHECKOUT_ROUTES: Routes = [
  {
    path: '',
    providers: [CheckoutService, CheckoutStore],
    loadComponent: () =>
      import('./components/checkout-page/checkout-page.component').then(m => m.CheckoutPageComponent),
    title: 'Activar plan',
  },
];
