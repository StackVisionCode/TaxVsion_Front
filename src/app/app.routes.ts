import { Routes } from '@angular/router';
import { AppShellComponent } from './layout/app-shell/app-shell.component';
import { authGuard } from '@core/auth/auth.guard';

export const routes: Routes = [
  {
    // El callback OAuth de Connectors (conectar buzón Gmail/Microsoft) NO vuelve a una ruta
    // propia: el backend redirige a la raíz del portal con `?connectors_connected=true&accountId=…`
    // o `?connectors_error=…`. Sin esto el usuario aterrizaría en el login/dashboard sin señal
    // de si su buzón quedó conectado, así que se desvía a la bandeja conservando los params.
    path: '',
    pathMatch: 'full',
    redirectTo: ({ queryParams }) =>
      queryParams['connectors_connected'] ||
      queryParams['connectors_error'] ||
      queryParams['connectors_admin_consent']
        ? '/email'
        : '/login',
  },
  {
    path: '',
    loadChildren: () => import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES),
  },
  {
    // Alta self-service pública (fuera del shell/authGuard): plan → cuenta → MFA → pago.
    path: 'signup',
    loadChildren: () => import('./features/signup/signup.routes').then(m => m.SIGNUP_ROUTES),
  },
  {
    // Alta PAGO-PRIMERO pública (fuera del shell/authGuard): email OTP → plan → códigos+pago (Stripe
    // o cubierto 100%) → email de registro. Ejercita el flujo /onboarding/* con gift/promo/referido.
    path: 'onboarding',
    loadChildren: () => import('./features/onboarding/onboarding.routes').then(m => m.ONBOARDING_ROUTES),
  },
  {
    // Link emailado post-pago ({RegistrationUrlBase}/register?token=...) y, sin token, el wizard
    // de compra nuevo. Fuera del shell/authGuard: el comprador todavía no tiene cuenta.
    path: 'register',
    loadChildren: () => import('./features/onboarding/onboarding.routes').then(m => m.REGISTER_ROUTES),
  },
  {
    // Canje de invitación de equipo: el invitado llega del correo que emite Notification
    // ({tenantPortalUrl}/accept-invitation?token=…) y todavía no tiene cuenta, así que va
    // fuera del shell/authGuard. Sin esta ruta el enlace daba 404.
    path: 'accept-invitation',
    loadComponent: () =>
      import('./features/auth/components/accept-invitation-page/accept-invitation-page.component').then(
        m => m.AcceptInvitationPageComponent,
      ),
    title: 'Accept invitation',
  },
  {
    // Confirmación de cambio de email: el enlace llega al correo NUEVO
    // ({Portal:BaseUrl}/confirm-email?token=…, ver EmailChangeRequestedConsumer) y puede
    // abrirse en otro dispositivo o sin sesión, así que va fuera del shell/authGuard.
    // Sin esta ruta el enlace daba 404 y el cambio quedaba a medias.
    path: 'confirm-email',
    loadComponent: () =>
      import('./features/auth/components/confirm-email-page/confirm-email-page.component').then(
        m => m.ConfirmEmailPageComponent,
      ),
    title: 'Confirm email',
  },
  {
    // Página pública de firma: el cliente llega por enlace, sin sesión (fuera del authGuard).
    path: 'sign/:token',
    loadComponent: () =>
      import('./features/signature/components/sign-page/sign-page.component').then(m => m.SignPageComponent),
    title: 'Sign document',
  },
  {
    // Alias de la anterior. El backend NO compone `/sign/<token>`: `SigningTokenService`
    // usa `Signature:PublicBaseUrl` + `/<token>`, y esa opción vale hoy
    // `…/signature/public`, así que el enlace emailado es `/signature/public/<token>`.
    // Aceptar ambas formas evita que el enlace muera si esa configuración cambia (o no).
    path: 'signature/public/:token',
    loadComponent: () =>
      import('./features/signature/components/sign-page/sign-page.component').then(m => m.SignPageComponent),
    title: 'Sign document',
  },
  {
    // Página pública de pago de una factura: el cliente llega por el link/QR del PDF, sin sesión.
    path: 'pay/:token',
    loadComponent: () =>
      import('./features/invoice-checkout/components/invoice-checkout-page/invoice-checkout-page.component').then(
        m => m.InvoiceCheckoutPageComponent
      ),
    title: 'Pagar factura',
  },
  {
    path: '',
    component: AppShellComponent,
    canActivateChild: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadChildren: () => import('./features/dashboard/dashboard.routes').then(m => m.DASHBOARD_ROUTES),
      },
      {
        // Apartado de facturación en vivo: métodos de pago + crear/emitir/cobrar facturas (backend real).
        path: 'billing',
        loadComponent: () =>
          import('./features/billing-live/components/billing-page/billing-page.component').then(
            m => m.BillingPageComponent
          ),
        title: 'Facturación',
      },
      {
        path: 'plans',
        loadChildren: () => import('./features/plans/plans.routes').then(m => m.PLANS_ROUTES),
      },
      {
        path: 'checkout',
        loadChildren: () => import('./features/checkout/checkout.routes').then(m => m.CHECKOUT_ROUTES),
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
        // La facturación real vive en /billing (features/billing-live); la vieja página mock
        // de invoices se retiró — se conserva la URL por links guardados.
        path: 'invoices',
        redirectTo: 'billing',
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
  {
    // Comodín: SIEMPRE al final. Sin él, cualquier URL desconocida (un enlace de correo
    // cortado al copiarlo, una ruta vieja) dejaba la pantalla en blanco sin explicación.
    path: '**',
    loadComponent: () =>
      import('./shared/ui/not-found-page/not-found-page.component').then(m => m.NotFoundPageComponent),
    title: 'Page not found',
  },
];
