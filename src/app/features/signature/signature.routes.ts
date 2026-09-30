import { Routes } from '@angular/router';
import { SignaturePageComponent } from './components/signature-page/signature-page.component';

export const SIGNATURE_ROUTES: Routes = [
  {
    path: '',
    component: SignaturePageComponent,
    title: 'Signature',
  },
  {
    // Autoría de plantillas reutilizables: /signature/templates (staff con permiso template.create).
    path: 'templates',
    loadComponent: () =>
      import('./components/signature-templates-page/signature-templates-page.component').then(
        m => m.SignatureTemplatesPageComponent,
      ),
    title: 'Signature templates',
  },
];
