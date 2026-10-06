import { Routes } from '@angular/router';
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
];
