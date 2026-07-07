import { Routes } from '@angular/router';

export const USER_MANAGEMENT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/user-management-page/user-management-page.component').then(
        m => m.UserManagementPageComponent,
      ),
    title: 'User Management',
  },
];
