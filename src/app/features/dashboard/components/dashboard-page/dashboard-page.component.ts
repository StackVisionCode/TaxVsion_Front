import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardHeroComponent } from '../../ui/dashboard-hero/dashboard-hero.component';
import { DashboardHoursSavedComponent } from '../../ui/dashboard-hours-saved/dashboard-hours-saved.component';
import { DashboardProBannerComponent } from '../../ui/dashboard-pro-banner/dashboard-pro-banner.component';
import { DashboardProductivityTrendsComponent } from '../../ui/dashboard-productivity-trends/dashboard-productivity-trends.component';
import { DashboardPerformanceTableComponent } from '../../ui/dashboard-performance-table/dashboard-performance-table.component';
import { DashboardAiInsightsComponent } from '../../ui/dashboard-ai-insights/dashboard-ai-insights.component';

/**
 * Página del dashboard al estilo de la referencia "Aether": hero con stat
 * cards, píldoras de horas + banner PRO, gráfico de productividad, tabla de
 * performance y columna de AI insights. Todo visual, datos estáticos.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [
    CommonModule,
    DashboardHeroComponent,
    DashboardHoursSavedComponent,
    DashboardProBannerComponent,
    DashboardProductivityTrendsComponent,
    DashboardPerformanceTableComponent,
    DashboardAiInsightsComponent,
  ],
  templateUrl: './dashboard-page.component.html',
})
export class DashboardPageComponent {}
