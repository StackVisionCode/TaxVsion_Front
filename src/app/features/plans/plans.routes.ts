import { Routes } from '@angular/router';
import { PlansService } from './data-access/plans.service';
import { PlansStore } from './data-access/plans.store';

export const PLANS_ROUTES: Routes = [
  {
    path: '',
    // El store y el service viven solo mientras se está en esta rama de rutas.
    providers: [PlansService, PlansStore],
    loadComponent: () =>
      import('./components/plans-page/plans-page.component').then(m => m.PlansPageComponent),
    title: 'Planes',
  },
];
