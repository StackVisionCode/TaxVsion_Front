import { Routes } from '@angular/router';
import { StoragePageComponent } from './components/storage-page/storage-page.component';

export const STORAGE_ROUTES: Routes = [
  {
    path: '',
    component: StoragePageComponent,
    title: 'Storage',
  },
];
