import { Routes } from '@angular/router';
import { permissionGuard } from '@core/auth/permission.guard';

export const TASK_ROUTES: Routes = [
  {
    path: '',
    canActivate: [permissionGuard('tasks.read')],
    loadComponent: () =>
      import('./components/task-page/task-page.component').then(m => m.TaskPageComponent),
    title: 'Task',
  },
];
