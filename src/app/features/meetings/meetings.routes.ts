import { Routes } from '@angular/router';
import { MeetingsPageComponent } from './components/meetings-page/meetings-page.component';

export const MEETINGS_ROUTES: Routes = [
  {
    path: '',
    component: MeetingsPageComponent,
    title: 'Meetings',
  },
];
