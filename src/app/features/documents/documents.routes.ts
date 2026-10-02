import { Routes } from '@angular/router';
import { DocumentsPageComponent } from './components/documents-page/documents-page.component';

export const DOCUMENTS_ROUTES: Routes = [
  {
    path: '',
    component: DocumentsPageComponent,
    title: 'Documents',
  },
];
