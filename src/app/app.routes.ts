import { Routes } from '@angular/router';
import { AppShellComponent } from './layout/app-shell/app-shell.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: '',
    loadChildren: () => import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES),
  },
  {
    path: '',
    component: AppShellComponent,
    children: [
      {
        path: 'dashboard',
        loadChildren: () => import('./features/dashboard/dashboard.routes').then(m => m.DASHBOARD_ROUTES),
      },
      {
        path: 'documents',
        loadChildren: () => import('./features/documents/documents.routes').then(m => m.DOCUMENTS_ROUTES),
      },
      {
        path: 'support',
        loadChildren: () => import('./features/support/support.routes').then(m => m.SUPPORT_ROUTES),
      },
      {
        path: 'settings',
        loadChildren: () => import('./features/settings/settings.routes').then(m => m.SETTINGS_ROUTES),
      },
      {
        path: 'products-services',
        loadChildren: () =>
          import('./features/products-services/products-services.routes').then(m => m.PRODUCTS_SERVICES_ROUTES),
      },
      {
        path: 'ai-assistant',
        loadChildren: () => import('./features/ai-assistant/ai-assistant.routes').then(m => m.AI_ASSISTANT_ROUTES),
      },
      {
        path: 'chat',
        loadChildren: () => import('./features/chat/chat.routes').then(m => m.CHAT_ROUTES),
      },
      {
        path: 'email',
        loadChildren: () => import('./features/mail/mail.routes').then(m => m.MAIL_ROUTES),
      },
      {
        path: 'task',
        loadChildren: () => import('./features/task/task.routes').then(m => m.TASK_ROUTES),
      },
      {
        path: 'meetings',
        loadChildren: () => import('./features/meetings/meetings.routes').then(m => m.MEETINGS_ROUTES),
      },
      {
        path: 'invoices',
        loadChildren: () => import('./features/invoices/invoices.routes').then(m => m.INVOICES_ROUTES),
      },
      {
        path: 'campaigns',
        loadChildren: () => import('./features/campaigns/campaigns.routes').then(m => m.CAMPAIGNS_ROUTES),
      },
      {
        path: 'signature',
        loadChildren: () => import('./features/signature/signature.routes').then(m => m.SIGNATURE_ROUTES),
      },
      {
        path: 'clients',
        loadChildren: () => import('./features/clients/clients.routes').then(m => m.CLIENTS_ROUTES),
      },
      {
        path: 'profile',
        loadChildren: () => import('./features/profile/profile.routes').then(m => m.PROFILE_ROUTES),
      },
      {
        path: 'company/users',
        loadChildren: () =>
          import('./features/user-management/user-management.routes').then(m => m.USER_MANAGEMENT_ROUTES),
      },
      {
        path: 'company/settings',
        loadChildren: () =>
          import('./features/company-settings/company-settings.routes').then(m => m.COMPANY_SETTINGS_ROUTES),
      },
      {
        path: 'notifications',
        loadChildren: () =>
          import('./features/notifications/notifications.routes').then(m => m.NOTIFICATIONS_ROUTES),
      },
      {
        path: 'referrals',
        loadChildren: () => import('./features/referrals/referrals.routes').then(m => m.REFERRALS_ROUTES),
      },
      {
        path: 'inventory',
        loadChildren: () => import('./features/inventory/inventory.routes').then(m => m.INVENTORY_ROUTES),
      },
      {
        path: 'storage',
        loadChildren: () => import('./features/storage/storage.routes').then(m => m.STORAGE_ROUTES),
      },
      {
        path: 'sms',
        loadChildren: () => import('./features/sms/sms.routes').then(m => m.SMS_ROUTES),
      },
      {
        path: 'templates',
        loadChildren: () => import('./features/templates/templates.routes').then(m => m.TEMPLATES_ROUTES),
      },
    ],
  },
];
