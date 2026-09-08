import { Routes } from '@angular/router';
import { WorkflowStore } from './data-access/workflow.store';
import { WorkflowPreviewService } from './data-access/workflow-preview.service';

export const WORKFLOW_ROUTES: Routes = [
  {
    path: '',
    // El store se provee en la ruta (convención del repo): su estado vive
    // mientras dure la pantalla y se descarta al salir.
    providers: [WorkflowStore, WorkflowPreviewService],
    loadComponent: () =>
      import('./components/workflow-page/workflow-page.component').then(m => m.WorkflowPageComponent),
    title: 'Workflow',
  },
];
