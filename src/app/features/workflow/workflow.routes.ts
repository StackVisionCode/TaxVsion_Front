import { Routes } from '@angular/router';
import { WorkflowStore } from './data-access/workflow.store';
import { WorkflowPreviewService } from './data-access/workflow-preview.service';

export const WORKFLOW_ROUTES: Routes = [
  {
    // Portada: los workflows guardados, en tabla. El builder ya no es la primera
    // pantalla del módulo — antes lo era porque solo existía un documento.
    path: '',
    providers: [WorkflowStore, WorkflowPreviewService],
    loadComponent: () =>
      import('./components/workflow-list-page/workflow-list-page.component').then(
        m => m.WorkflowListPageComponent,
      ),
    title: 'Workflows',
  },
  {
    // El id en la URL hace que un workflow se pueda compartir y recargar sin perderlo.
    path: ':id',
    providers: [WorkflowStore, WorkflowPreviewService],
    loadComponent: () =>
      import('./components/workflow-page/workflow-page.component').then(m => m.WorkflowPageComponent),
    title: 'Workflow',
  },
];
