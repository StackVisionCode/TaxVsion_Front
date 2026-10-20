import { Routes } from '@angular/router';
import { accessCanMatch } from '@core/access/access.guard';
import { SettingsPageComponent } from './components/settings-page/settings-page.component';
import { BillingStore } from '../billing/data-access/billing.store';
import { ConnectionsStore } from './data-access/connections.store';

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
    // Preferencias de notificación del staff (FASE 8 del plan). Autoservicio sin
    // permiso especial — el backend filtra por el UserId del JWT.
    path: 'notifications',
    loadComponent: () =>
      import('./components/notification-preferences-page/notification-preferences-page.component').then(
        m => m.NotificationPreferencesPageComponent,
      ),
    title: 'Notification preferences',
  },
];
