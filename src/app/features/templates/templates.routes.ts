import { Routes } from '@angular/router';

export const TEMPLATES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/templates-page/templates-page.component').then(m => m.TemplatesPageComponent),
    title: 'Templates',
  },
];
