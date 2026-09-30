import { Routes } from '@angular/router';
import { AiAssistantPageComponent } from './components/ai-assistant-page/ai-assistant-page.component';

export const AI_ASSISTANT_ROUTES: Routes = [
  {
    path: '',
    component: AiAssistantPageComponent,
    title: 'AI Assistant',
  },
];
