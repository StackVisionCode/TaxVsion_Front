import { Routes } from '@angular/router';

export const SIGNATURE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/signature-page/signature-page.component').then(m => m.SignaturePageComponent),
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
