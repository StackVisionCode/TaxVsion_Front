import { Routes } from '@angular/router';
import { TemplatesPageComponent } from './components/templates-page/templates-page.component';

export const TEMPLATES_ROUTES: Routes = [
  {
    path: '',
    component: TemplatesPageComponent,
    title: 'Templates',
  },
];
