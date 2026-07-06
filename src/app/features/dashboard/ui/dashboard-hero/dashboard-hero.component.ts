import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';

interface HeroStat {
  title: string;
  subtitle: string;
  value: string;
  bg: string;
}

/**
 * Zona hero del dashboard (referencia "Aether"): saludo grande + 3 stat cards
 * pastel con botón circular negro recortado en la esquina. Datos estáticos,
 * adaptados al dominio CRM.
 */
@Component({
  selector: 'app-dashboard-hero',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-hero.component.html',
})
export class DashboardHeroComponent {
  readonly userName = 'Jordan';

  readonly stats: HeroStat[] = [
    { title: 'Total Customers', subtitle: 'Active portfolio', value: '128', bg: 'bg-[#F2E3C9]' },
    { title: 'Pending Invoices', subtitle: 'Awaiting payment', value: '14', bg: 'bg-[#CBD9F2]' },
    { title: 'Monthly Revenue', subtitle: 'This month', value: '$42,500', bg: 'bg-[#DCDCDC]' },
  ];
}
