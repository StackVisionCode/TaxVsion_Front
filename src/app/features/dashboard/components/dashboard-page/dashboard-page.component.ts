import { Component, ElementRef, Injector, NgZone, afterNextRender, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { measureRects, playFlip } from '@shared/utils/flip.util';
import { AuthService } from '@core/auth/auth.service';
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
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';

/**
 * Página del dashboard al estilo de la referencia "Aether". Los widgets se
 * renderizan desde el DashboardLayoutStore (orden reordenable): el botón
 * "Edit layout" de la barra superior activa el modo edición y cada widget se
 * puede arrastrar (CDK drag & drop). El orden persiste en localStorage.
 *
 * Arrastre fluido (modo edición): con `cdkDropListOrientation="mixed"` el CDK reordena moviendo
 * nodos del DOM y NO anima a los vecinos, así que se animan aquí con FLIP (`shared/utils/flip.util`):
 * en cada `cdkDropListSorted` los demás widgets se deslizan a su nuevo sitio, y al soltar se anima
 * también el cambio de ancho por slot. El hueco toma el tamaño real del widget agarrado y el
 * preview se "levanta" (escala + giro) y se "asienta" al soltar (ver el CSS).
 *
 * Los datos NO son estáticos: cada widget carga lo suyo desde su servicio o
 * store real (clientes, facturas, tareas, firmas, chats, reuniones, notas,
 * notificaciones, storage, calendario). Los dos widgets que hoy no tienen
 * backend que los respalde — Productivity Trends y Performance Analytics —
 * conservan su marco pero muestran un estado vacío honesto en lugar de
 * cifras inventadas.
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
    SkeletonComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.css',
})
export class DashboardPageComponent {
  readonly layout = inject(DashboardLayoutStore);
  private readonly auth = inject(AuthService);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly zone = inject(NgZone);

  readonly userName = computed(() => this.auth.currentUser()?.name ?? '');

  /** Tamaño del widget agarrado: el hueco (placeholder) lo copia para que la grilla no salte. */
  readonly dragSize = signal<{ height: number; colSpan: 1 | 2 } | null>(null);

  /** Posiciones de layout de las celdas tras el último reordenamiento (el "First" del FLIP). */
  private cellRects = new Map<HTMLElement, DOMRect>();

  /** Celdas reales de la grilla + el hueco (sin el preview que sigue al cursor). */
  private cells(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.widget-cell:not(.cdk-drag-preview), .drop-slot'));
  }

  /**
   * Al presionar sobre un widget (antes de que arranque el drag) se guarda su tamaño: el CDK crea
   * el hueco ANTES de emitir `cdkDragStarted`, y así nace ya con el tamaño correcto.
   */
  primeDrag(event: PointerEvent, colSpan: 1 | 2): void {
    if (!this.layout.editMode()) {
      return;
    }
    const height = (event.currentTarget as HTMLElement).getBoundingClientRect().height;
    this.dragSize.set({ height, colSpan });
  }

  onDragStarted(): void {
    // Tras pintar el hueco se toma la foto inicial de la grilla.
    afterNextRender(() => (this.cellRects = measureRects(this.cells())), { injector: this.injector });
  }

  /** El CDK ya movió el hueco en el DOM: los vecinos se deslizan desde donde estaban. */
  onSorted(): void {
    this.zone.runOutsideAngular(() => {
      const cells = this.cells();
      const before = this.cellRects;
      // Se guarda la posición de LAYOUT nueva (antes de invertir) para el próximo reordenamiento.
      playFlip(cells, before, { duration: 240 });
      this.cellRects = new Map(cells.map(cell => [cell, layoutRect(cell)]));
    });
  }

  onDrop(event: CdkDragDrop<DashboardWidgetConfig[]>): void {
    const before = measureRects(this.cells());
    this.dragSize.set(null);
    this.layout.move(event.previousIndex, event.currentIndex);
    // Tras el re-render (nuevo orden + anchos por slot) todo se desliza a su lugar en vez de saltar.
    afterNextRender(
      () => this.zone.runOutsideAngular(() => playFlip(this.cells(), before, { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })),
      { injector: this.injector },
    );
  }
}

/** Rect de layout del elemento, descontando el `translate` de una animación FLIP en curso. */
function layoutRect(el: HTMLElement): DOMRect {
  const rect = el.getBoundingClientRect();
  if (!el.style.translate) {
    return rect;
  }
  const [x = '0', y = '0'] = el.style.translate.split(/\s+/);
  return new DOMRect(rect.left - parseFloat(x), rect.top - parseFloat(y), rect.width, rect.height);
}
