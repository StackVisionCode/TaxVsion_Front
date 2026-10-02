import { Routes } from '@angular/router';
import { ProductsServicesPageComponent } from './components/products-services-page/products-services-page.component';

export const PRODUCTS_SERVICES_ROUTES: Routes = [
  {
    path: '',
    component: ProductsServicesPageComponent,
    title: 'Products & Services',
  },
];
