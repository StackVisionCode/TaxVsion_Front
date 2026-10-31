import { Routes } from '@angular/router';
import { accessCanMatch } from '@core/access/access.guard';
import { SettingsPageComponent } from './components/settings-page/settings-page.component';
import { BillingStore } from '../billing/data-access/billing.store';
import { ConnectionsStore } from './data-access/connections.store';
import { EmailActivityStore } from './data-access/email-activity.store';

export const SETTINGS_ROUTES: Routes = [
  {
    path: '',
    component: SettingsPageComponent,
    title: 'Settings',
  },
  {
    // Configuración de facturación (proveedores de cobro + empresa/branding). Vive DENTRO de Settings;
    // el componente lo posee la feature billing (reusa sus formularios + BillingStore).
    path: 'billing',
    providers: [BillingStore],
    loadComponent: () =>
      import('../billing/components/billing-settings-page/billing-settings-page.component').then(
        m => m.BillingSettingsPageComponent,
      ),
    title: 'Billing settings',
  },
  {
    // Conexiones de terceros para la IA (proveedores, cuentas OAuth, servidores MCP). Solo front:
    // el store guarda en memoria hasta que exista la API — ver connections.store.ts.
    path: 'connections',
    providers: [ConnectionsStore],
    loadComponent: () =>
      import('./components/connections-page/connections-page.component').then(m => m.ConnectionsPageComponent),
    title: 'Connections & MCP',
  },
  {
    // Ajustes globales de firma del despacho. Página dedicada (reemplaza el panel inline muerto),
    // gateada por signature.settings.manage. El componente lo posee la feature signature.
    path: 'signature',
    canMatch: [accessCanMatch],
    data: { feature: 'signature-settings' },
    loadComponent: () =>
      import('../signature/components/signature-settings-page/signature-settings-page.component').then(
        m => m.SignatureSettingsPageComponent,
      ),
    title: 'Signature settings',
  },
  {
    // "My Signature" personal del preparador. Gateada por signature.preparer.manage; el backend
    // cierra el resto. Separada de la gobernanza del despacho (página de arriba).
    path: 'my-signature',
    canMatch: [accessCanMatch],
    data: { feature: 'my-signature' },
    loadComponent: () =>
      import('../signature/components/my-signature-page/my-signature-page.component').then(
        m => m.MySignaturePageComponent,
      ),
    title: 'My signature',
  },
  {
    // F9 (D-38): Settings → Communication. Un store para las cuatro páginas (borrador compartido); cada página
    // con su feature (permiso de gobernanza + módulo). El componente lo posee la feature communication-settings.
    path: 'communication',
    loadChildren: () =>
      import('../communication-settings/communication-settings.routes').then(m => m.COMMUNICATION_SETTINGS_ROUTES),
  },
  {
    // F9: preferencias personales de Communication (autoservicio, el backend usa el UserId del JWT).
    path: 'communication-preferences',
    loadComponent: () =>
      import('../communication-settings/components/communication-preferences-page/communication-preferences-page.component').then(
        m => m.CommunicationPreferencesPageComponent,
      ),
    title: 'Communication preferences',
  },
  {
    // Preferencias de notificación del staff (FASE 8 del plan). Autoservicio sin
    // permiso especial — el backend filtra por el UserId del JWT.
    path: 'notifications',
    loadComponent: () =>
      import('./components/notification-preferences-page/notification-preferences-page.component').then(
        m => m.NotificationPreferencesPageComponent,
      ),
    title: 'Notification preferences',
  },
  {
    // Estado real de entrega de los correos de la oficina (Postmaster). Gateada por
    // postmaster.messages.read; el backend enmascara las direcciones para quien no es admin.
    path: 'email-activity',
    canMatch: [accessCanMatch],
    data: { feature: 'email-activity' },
    providers: [EmailActivityStore],
    loadComponent: () =>
      import('./components/email-activity-page/email-activity-page.component').then(m => m.EmailActivityPageComponent),
    title: 'Email activity',
  },
];
