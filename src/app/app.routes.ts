import { Routes } from '@angular/router';
import { AppShellComponent } from './layout/app-shell/app-shell.component';
import { authGuard } from '@core/auth/auth.guard';

/**
 * Convención de precarga (ver `PacedPreloadStrategy` en core/performance):
 * - Sin `data`  → se precarga en segundo plano, espaciada, tras el primer NavigationEnd.
 * - `preload: false` → NUNCA se precarga sola. Para rutas públicas (un usuario del CRM no
 *   las visita jamás) y para las secciones más caras del shell, que además se precargan a
 *   demanda al pasar el mouse por su ítem del sidebar.
 * - `preloadPriority: 'low'` → se precarga, pero varios segundos después, para no competir
 *   con las secciones del menú caliente.
 */
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
    // Login/MFA/recuperación. Ya autenticado no hace falta, pero se precarga en baja
    // prioridad para que el logout (y el aterrizaje de un token vencido) no espere el chunk.
    path: '',
    data: { preloadPriority: 'low' },
    loadChildren: () => import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES),
  },
  {
    // Alta self-service pública (fuera del shell/authGuard): plan → cuenta → MFA → pago.
    path: 'signup',
    data: { preload: false },
    loadChildren: () => import('./features/signup/signup.routes').then(m => m.SIGNUP_ROUTES),
  },
  {
    // Alta PAGO-PRIMERO pública (fuera del shell/authGuard): email OTP → plan → códigos+pago (Stripe
    // o cubierto 100%) → email de registro. Ejercita el flujo /onboarding/* con gift/promo/referido.
    path: 'onboarding',
    data: { preload: false },
    loadChildren: () => import('./features/onboarding/onboarding.routes').then(m => m.ONBOARDING_ROUTES),
  },
  {
    // Link emailado post-pago ({RegistrationUrlBase}/register?token=...) y, sin token, el wizard
    // de compra nuevo. Fuera del shell/authGuard: el comprador todavía no tiene cuenta.
    path: 'register',
    data: { preload: false },
    loadChildren: () => import('./features/onboarding/onboarding.routes').then(m => m.REGISTER_ROUTES),
  },
  {
    // Canje de invitación de equipo: el invitado llega del correo que emite Notification
    // ({tenantPortalUrl}/accept-invitation?token=…) y todavía no tiene cuenta, así que va
    // fuera del shell/authGuard. Sin esta ruta el enlace daba 404.
    path: 'accept-invitation',
    data: { preload: false },
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
    data: { preload: false },
    loadComponent: () =>
      import('./features/auth/components/confirm-email-page/confirm-email-page.component').then(
        m => m.ConfirmEmailPageComponent,
      ),
    title: 'Confirm email',
  },
  {
    // Página pública de firma: el cliente llega por enlace, sin sesión (fuera del authGuard).
    path: 'sign/:token',
    data: { preload: false },
    loadComponent: () =>
      import('./features/signature/components/sign-page/sign-page.component').then(m => m.SignPageComponent),
    title: 'Sign document',
  },
  {
    // Verificación pública de la cadena de audit de una firma. Fuera del authGuard por
    // el mismo motivo que /sign/:token: la autoriza el token del firmante, no una
    // sesión. Es de SOLO LECTURA (GET /signature/public/{token}/verify-audit): muestra
    // el veredicto de integridad y las filas encadenadas, sin mutar nada.
    path: 'verify/:token',
    data: { preload: false },
    loadComponent: () =>
      import('./features/signature/components/verify-audit-page/verify-audit-page.component').then(
        m => m.VerifyAuditPageComponent,
      ),
    title: 'Verify audit trail',
  },
  {
    // Alias con el mismo prefijo que el enlace emailado (`/signature/public/<token>`):
    // pegarle `/verify-audit` a mano es lo natural para quien copia la ruta de la API.
    // Va ANTES de `signature/public/:token` porque es la más específica de las dos.
    path: 'signature/public/:token/verify-audit',
    data: { preload: false },
    loadComponent: () =>
      import('./features/signature/components/verify-audit-page/verify-audit-page.component').then(
        m => m.VerifyAuditPageComponent,
      ),
    title: 'Verify audit trail',
  },
  {
    // Alias de la página de firma. El backend NO compone `/sign/<token>`:
    // `SigningTokenService` usa `Signature:PublicBaseUrl` + `/<token>`, y esa opción
    // vale hoy `…/signature/public`, así que el enlace emailado es
    // `/signature/public/<token>`. Aceptar ambas formas evita que el enlace muera si
    // esa configuración cambia (o no).
    path: 'signature/public/:token',
    data: { preload: false },
    loadComponent: () =>
      import('./features/signature/components/sign-page/sign-page.component').then(m => m.SignPageComponent),
    title: 'Sign document',
  },
  {
    // Puente del enlace de descarga del correo de firma completada. El correo lo arma con la
    // base del CRM (front), pero `/storage/public/<token>` es un endpoint del backend
    // (CloudStorage). En dev (front 4200 ≠ Gateway 5047) esta página redirige al backend; en
    // prod el Gateway del subdominio sirve la ruta directamente y esto ni se alcanza.
    path: 'storage/public/:token',
    data: { preload: false },
    loadComponent: () =>
      import('./features/signature/components/public-share-redirect/public-share-redirect.component').then(
        m => m.PublicShareRedirectComponent,
      ),
    title: 'Download document',
  },
  {
    // Página pública de un enlace compartido de Documents: el cliente externo llega por
    // `https://<oficina>.taxproffice.com/s/<token>`, sin sesión (fuera del authGuard). Muestra el
    // documento con la marca de la oficina y dispara la descarga contra el resolver del backend.
    path: 's/:token',
    data: { preload: false },
    loadComponent: () =>
      import('./features/public-share/public-share-page.component').then(m => m.PublicSharePageComponent),
    title: 'Shared document',
  },
  {
    // Página pública de pago de una factura: el cliente llega por el link/QR del PDF, sin sesión.
    path: 'pay/:token',
    data: { preload: false },
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
        // Facturación del tenant: facturas (Billing), links de pago y proveedor de cobro
        // (PaymentClient) y datos de la empresa que se estampan en el PDF (Billing + Documents).
        path: 'billing',
        loadChildren: () => import('./features/billing/billing.routes').then(m => m.BILLING_ROUTES),
      },
      {
        path: 'plans',
        data: { preloadPriority: 'low' },
        loadChildren: () => import('./features/plans/plans.routes').then(m => m.PLANS_ROUTES),
      },
      {
        // Arrastra el SDK de Stripe y solo se visita desde el flujo de compra.
        path: 'checkout',
        data: { preload: false },
        loadChildren: () => import('./features/checkout/checkout.routes').then(m => m.CHECKOUT_ROUTES),
      },
      {
        path: 'subscription',
        data: { preloadPriority: 'low' },
        loadChildren: () =>
          import('./features/subscription/subscription.routes').then(m => m.SUBSCRIPTION_ROUTES),
      },
      {
        path: 'workflow',
        loadChildren: () => import('./features/workflow/workflow.routes').then(m => m.WORKFLOW_ROUTES),
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
        data: { preloadPriority: 'low' },
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
        // mediasoup-client pesa ~316 kB sin comprimir y solo lo necesita quien entra a una
        // videollamada. Se precarga a demanda desde el hover del sidebar.
        path: 'meetings',
        data: { preload: false },
        loadChildren: () => import('./features/meetings/meetings.routes').then(m => m.MEETINGS_ROUTES),
      },
      {
        // La facturación vive en /billing (features/billing); la vieja página mock de invoices
        // se retiró — se conserva la URL por links guardados.
        path: 'invoices',
        redirectTo: 'billing',
      },
      {
        path: 'campaigns',
        data: { preloadPriority: 'low' },
        loadChildren: () => import('./features/campaigns/campaigns.routes').then(m => m.CAMPAIGNS_ROUTES),
      },
      {
        // Arrastra pdf.js: es el chunk más grande de la app (~430 kB sin comprimir). Se
        // precarga a demanda desde el hover del sidebar.
        path: 'signature',
        data: { preload: false },
        loadChildren: () => import('./features/signature/signature.routes').then(m => m.SIGNATURE_ROUTES),
      },
      {
        path: 'clients',
        loadChildren: () => import('./features/clients/clients.routes').then(m => m.CLIENTS_ROUTES),
      },
      {
        path: 'profile',
        data: { preloadPriority: 'low' },
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
        data: { preloadPriority: 'low' },
        loadChildren: () =>
          import('./features/notifications/notifications.routes').then(m => m.NOTIFICATIONS_ROUTES),
      },
      {
        path: 'referrals',
        data: { preloadPriority: 'low' },
        loadChildren: () => import('./features/referrals/referrals.routes').then(m => m.REFERRALS_ROUTES),
      },
      {
        path: 'inventory',
        data: { preloadPriority: 'low' },
        loadChildren: () => import('./features/inventory/inventory.routes').then(m => m.INVENTORY_ROUTES),
      },
      {
        path: 'storage',
        loadChildren: () => import('./features/storage/storage.routes').then(m => m.STORAGE_ROUTES),
      },
      {
        path: 'sms',
        data: { preloadPriority: 'low' },
        loadChildren: () => import('./features/sms/sms.routes').then(m => m.SMS_ROUTES),
      },
      {
        path: 'templates',
        data: { preloadPriority: 'low' },
        loadChildren: () => import('./features/templates/templates.routes').then(m => m.TEMPLATES_ROUTES),
      },
    ],
  },
  {
    // Comodín: SIEMPRE al final. Sin él, cualquier URL desconocida (un enlace de correo
    // cortado al copiarlo, una ruta vieja) dejaba la pantalla en blanco sin explicación.
    path: '**',
    data: { preload: false },
    loadComponent: () =>
      import('./shared/ui/not-found-page/not-found-page.component').then(m => m.NotFoundPageComponent),
    title: 'Page not found',
  },
];
