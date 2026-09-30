import { Routes } from '@angular/router';

export const TASK_ROUTES: Routes = [
  {
    // El acceso lo decide `accessCanMatch` en la ruta del shell (feature `task`), con la misma
    // regla de antes (`tasks.read`) más el módulo del plan, y explicando por qué en vez de
    // devolver al panel en silencio.
    path: '',
    loadComponent: () =>
      import('./components/task-page/task-page.component').then(m => m.TaskPageComponent),
    title: 'Task',
  },
];
