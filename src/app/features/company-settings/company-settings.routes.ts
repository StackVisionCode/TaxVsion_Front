import { Routes } from '@angular/router';
import { CompanySettingsPageComponent } from './components/company-settings-page/company-settings-page.component';

export const COMPANY_SETTINGS_ROUTES: Routes = [
  {
    path: '',
    component: CompanySettingsPageComponent,
    title: 'Company Settings',
  },
];
