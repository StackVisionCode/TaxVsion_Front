import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardFiltersComponent } from '../../ui/dashboard-filters/dashboard-filters.component';
import { DashboardModulesComponent } from '../../ui/dashboard-modules/dashboard-modules.component';

/**
 * Página principal del dashboard. Combina la barra de filtros y la grilla de
 * módulos. Todo visual: `filtersApplied`/`preparerSelected` no están
 * conectados a ningún dato real todavía.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [CommonModule, DashboardFiltersComponent, DashboardModulesComponent],
  templateUrl: './dashboard-page.component.html',
})
export class DashboardPageComponent {}
