import { Routes } from '@angular/router';

export const PRODUCTS_SERVICES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/products-services-page/products-services-page.component').then(
        m => m.ProductsServicesPageComponent,
      ),
    title: 'Products & Services',
  },
];
