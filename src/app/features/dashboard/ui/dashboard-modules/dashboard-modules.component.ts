import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardStatisticsComponent } from '../dashboard-statistics/dashboard-statistics.component';
import { DashboardMiniCalendarComponent } from '../dashboard-mini-calendar/dashboard-mini-calendar.component';
import { DashboardInvoicesChartComponent } from '../dashboard-invoices-chart/dashboard-invoices-chart.component';
import { DashboardTasksComponent } from '../dashboard-tasks/dashboard-tasks.component';
import { DashboardWeatherComponent } from '../dashboard-weather/dashboard-weather.component';
import { DashboardNotesComponent } from '../dashboard-notes/dashboard-notes.component';
import { DashboardMonthlyClientsComponent } from '../dashboard-monthly-clients/dashboard-monthly-clients.component';
import { DashboardSignedDocumentsComponent } from '../dashboard-signed-documents/dashboard-signed-documents.component';
import { DashboardVideoCallsComponent } from '../dashboard-video-calls/dashboard-video-calls.component';
import { DashboardRecentChatsComponent } from '../dashboard-recent-chats/dashboard-recent-chats.component';
import { DashboardRecentActivityComponent } from '../dashboard-recent-activity/dashboard-recent-activity.component';
import { DashboardStorageUsageComponent } from '../dashboard-storage-usage/dashboard-storage-usage.component';

/**
 * Contenedor visual de los widgets del dashboard, en una grilla estática de 12 columnas
 * (misma proporción normal/wide del original). Sin drag-and-drop ni modo edición/añadir
 * módulo: todo visual, sin @angular/cdk ni persistencia de layout.
 */
@Component({
  selector: 'app-dashboard-modules',
  imports: [
    CommonModule,
    DashboardStatisticsComponent,
    DashboardMiniCalendarComponent,
    DashboardInvoicesChartComponent,
    DashboardTasksComponent,
    DashboardWeatherComponent,
    DashboardNotesComponent,
    DashboardMonthlyClientsComponent,
    DashboardSignedDocumentsComponent,
    DashboardVideoCallsComponent,
    DashboardRecentChatsComponent,
    DashboardRecentActivityComponent,
    DashboardStorageUsageComponent,
  ],
  templateUrl: './dashboard-modules.component.html',
})
export class DashboardModulesComponent {}
