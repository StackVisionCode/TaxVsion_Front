import { Routes } from '@angular/router';
import { SettingsPageComponent } from './components/settings-page/settings-page.component';
import { BillingStore } from '../billing/data-access/billing.store';

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
];
