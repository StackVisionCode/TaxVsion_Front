import { Routes } from '@angular/router';
import { PlansPageComponent } from './components/plans-page/plans-page.component';
import { PlansStore } from './data-access/plans.store';

export const PLANS_ROUTES: Routes = [
  {
    path: '',
    // El store vive solo mientras se está en esta rama de rutas.
    providers: [PlansStore],
    component: PlansPageComponent,
    title: 'Planes',
  },
];
