import { Routes } from '@angular/router';
import { UserManagementPageComponent } from './components/user-management-page/user-management-page.component';

export const USER_MANAGEMENT_ROUTES: Routes = [
  {
    path: '',
    component: UserManagementPageComponent,
    title: 'User Management',
  },
];
