import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { DashboardLayoutStore, DashboardWidgetConfig } from '../../data-access/dashboard-layout.store';
import { DashboardHeroComponent } from '../../ui/dashboard-hero/dashboard-hero.component';
import { DashboardProBannerComponent } from '../../ui/dashboard-pro-banner/dashboard-pro-banner.component';
import { DashboardProductivityTrendsComponent } from '../../ui/dashboard-productivity-trends/dashboard-productivity-trends.component';
import { DashboardPerformanceTableComponent } from '../../ui/dashboard-performance-table/dashboard-performance-table.component';
import { DashboardTasksComponent } from '../../ui/dashboard-tasks/dashboard-tasks.component';
import { DashboardMiniCalendarComponent } from '../../ui/dashboard-mini-calendar/dashboard-mini-calendar.component';
import { DashboardRecentChatsComponent } from '../../ui/dashboard-recent-chats/dashboard-recent-chats.component';
import { DashboardRecentActivityComponent } from '../../ui/dashboard-recent-activity/dashboard-recent-activity.component';
import { DashboardVideoCallsComponent } from '../../ui/dashboard-video-calls/dashboard-video-calls.component';
import { DashboardInvoicesChartComponent } from '../../ui/dashboard-invoices-chart/dashboard-invoices-chart.component';
import { DashboardStorageUsageComponent } from '../../ui/dashboard-storage-usage/dashboard-storage-usage.component';
import { DashboardSignedDocumentsComponent } from '../../ui/dashboard-signed-documents/dashboard-signed-documents.component';
import { DashboardMonthlyClientsComponent } from '../../ui/dashboard-monthly-clients/dashboard-monthly-clients.component';
import { DashboardNotesComponent } from '../../ui/dashboard-notes/dashboard-notes.component';
import { DashboardFiltersComponent } from '../../ui/dashboard-filters/dashboard-filters.component';

/**
 * Página del dashboard al estilo de la referencia "Aether". Los widgets se
 * renderizan desde el DashboardLayoutStore (orden reordenable): el botón
 * "Edit layout" de la barra de filtros activa el modo edición y cada widget
 * se puede arrastrar (CDK drag & drop) con animaciones de recolocación
 * suaves. Todo visual, datos estáticos; el orden persiste en localStorage.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [
    CommonModule,
    DragDropModule,
    DashboardHeroComponent,
    DashboardProBannerComponent,
    DashboardProductivityTrendsComponent,
    DashboardPerformanceTableComponent,
    DashboardTasksComponent,
    DashboardMiniCalendarComponent,
    DashboardRecentChatsComponent,
    DashboardRecentActivityComponent,
    DashboardVideoCallsComponent,
    DashboardInvoicesChartComponent,
    DashboardStorageUsageComponent,
    DashboardSignedDocumentsComponent,
    DashboardMonthlyClientsComponent,
    DashboardNotesComponent,
    DashboardFiltersComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.css',
})
export class DashboardPageComponent {
  readonly layout = inject(DashboardLayoutStore);

  onDrop(event: CdkDragDrop<DashboardWidgetConfig[]>): void {
    this.layout.move(event.previousIndex, event.currentIndex);
  }

  trackById(_index: number, widget: DashboardWidgetConfig): string {
    return widget.id;
  }
}
