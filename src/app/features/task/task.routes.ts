import { Routes } from '@angular/router';

export const TASK_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/task-page/task-page.component').then(m => m.TaskPageComponent),
    title: 'Task',
  },
];
