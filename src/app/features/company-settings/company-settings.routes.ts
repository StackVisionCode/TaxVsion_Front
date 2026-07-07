import { Routes } from '@angular/router';

export const COMPANY_SETTINGS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/company-settings-page/company-settings-page.component').then(
        m => m.CompanySettingsPageComponent,
      ),
    title: 'Company Settings',
  },
];
