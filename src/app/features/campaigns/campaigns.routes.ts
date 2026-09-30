import { Routes } from '@angular/router';
import { CampaignsPageComponent } from './components/campaigns-page/campaigns-page.component';

export const CAMPAIGNS_ROUTES: Routes = [
  {
    path: '',
    component: CampaignsPageComponent,
    title: 'Campaigns',
  },
];
