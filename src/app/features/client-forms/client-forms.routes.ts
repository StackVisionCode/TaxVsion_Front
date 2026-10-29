import type { Routes } from '@angular/router';
import { FormTemplateBuilderStore } from './data-access/form-template-builder.store';
import { FormTemplatesStore } from './data-access/form-templates.store';
import { FormRequestsStore } from './data-access/form-requests.store';
import { ClientFormsAvailabilityStore } from './data-access/client-forms-availability.store';
import { ClientFormsHomeComponent } from './components/client-forms-home/client-forms-home.component';

export const CLIENT_FORMS_ROUTES: Routes = [
  {
    path: '',
    providers: [FormTemplatesStore, FormRequestsStore, ClientFormsAvailabilityStore],
    component: ClientFormsHomeComponent,
    title: 'Client Forms',
  },
  {
    path: 'templates/:id',
    providers: [FormTemplateBuilderStore],
    loadComponent: () =>
      import('./components/form-template-builder/form-template-builder.component').then(
        (m) => m.FormTemplateBuilderComponent,
      ),
    // Al salir se espera el guardado del draft; si falla, se pregunta (P-6.2).
    canDeactivate: [
      (component: { canDeactivate(): Promise<boolean> } | null) =>
        component?.canDeactivate() ?? true,
    ],
    title: 'Form builder',
  },
];
