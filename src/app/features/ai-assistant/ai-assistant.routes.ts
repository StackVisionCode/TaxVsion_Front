import { Routes } from '@angular/router';

export const AI_ASSISTANT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/ai-assistant-page/ai-assistant-page.component').then(m => m.AiAssistantPageComponent),
    title: 'AI Assistant',
  },
];
