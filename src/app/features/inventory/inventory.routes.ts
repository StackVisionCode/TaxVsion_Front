import { Routes } from '@angular/router';
import { InventoryPageComponent } from './components/inventory-page/inventory-page.component';

export const INVENTORY_ROUTES: Routes = [
  {
    path: '',
    component: InventoryPageComponent,
    title: 'Inventory',
  },
];
