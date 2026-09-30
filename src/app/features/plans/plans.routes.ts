import { Routes } from '@angular/router';
import { PlansStore } from './data-access/plans.store';

export const PLANS_ROUTES: Routes = [
  {
    path: '',
    // El store vive solo mientras se está en esta rama de rutas.
    providers: [PlansStore],
    loadComponent: () =>
      import('./components/plans-page/plans-page.component').then(m => m.PlansPageComponent),
    title: 'Planes',
  },
];
