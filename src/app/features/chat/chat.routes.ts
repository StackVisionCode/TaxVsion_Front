import { Routes } from '@angular/router';
import { ChatPageComponent } from './components/chat-page/chat-page.component';

export const CHAT_ROUTES: Routes = [
  {
    path: '',
    component: ChatPageComponent,
    title: 'Chat',
  },
];
