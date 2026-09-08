import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CountUpDirective } from '../../../../shared/directives/count-up.directive';
import { CustomerImportAttempt, CustomerImportRow, ImportRowStatus } from '../../data-access/client-imports.model';

type RowFilter = 'failed' | 'all';

/** Filas por página del informe: `GET /{id}/report` devuelve el intento completo, sin paginar. */
const ROWS_PAGE_SIZE = 10;

/**
 * Paso 3 del wizard: resultado.
 *
 * Los totales salen del propio intento (`GET /{id}`), que es la fuente autoritativa de los
 * contadores; el detalle fila por fila viene de `GET /{id}/report?format=json`. Por defecto
 * se muestran sólo las filas fallidas, que es lo accionable.
 */
@Component({
  selector: 'app-client-import-result-step',
  imports: [CommonModule, RouterModule, CountUpDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-import-result-step.component.html',
  styleUrl: './client-import-result-step.component.css',
})
export class ClientImportResultStepComponent {
  @Input({ required: true }) attempt!: CustomerImportAttempt;
  @Input() set rows(value: CustomerImportRow[]) {
    this.allRows.set(value ?? []);
    this.page.set(1);
  }
  @Input() rowsLoading = false;
  @Input() rowsError: string | null = null;
  @Input() csvDownloading = false;

  @Output() reloadRowsRequested = new EventEmitter<void>();
  @Output() downloadCsvRequested = new EventEmitter<void>();
  @Output() startAnotherRequested = new EventEmitter<void>();

  readonly allRows = signal<CustomerImportRow[]>([]);
  readonly filter = signal<RowFilter>('failed');
  readonly page = signal(1);
  readonly pageSize = ROWS_PAGE_SIZE;

  readonly failedRows = computed(() => this.allRows().filter(row => row.status === 'Failed'));

  readonly visibleRows = computed(() =>
    this.filter() === 'failed' ? this.failedRows() : this.allRows(),
  );

  readonly pagedRows = computed(() => {
    const start = (this.page() - 1) * ROWS_PAGE_SIZE;
    return this.visibleRows().slice(start, start + ROWS_PAGE_SIZE);
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.visibleRows().length / ROWS_PAGE_SIZE)));

  setFilter(value: RowFilter): void {
    this.filter.set(value);
    this.page.set(1);
  }

  goToPage(page: number): void {
    this.page.set(Math.min(Math.max(1, page), this.totalPages()));
  }

  /** Banner de cierre. `Failed` trae `failureReason`; `Canceled` puede tener filas ya aplicadas. */
  get outcomeTitle(): string {
    switch (this.attempt.status) {
      case 'Completed':
        return 'Import completed';
      case 'Failed':
        return 'Import failed';
      case 'Canceled':
        return 'Import canceled';
      default:
        return 'Import finished';
    }
  }

  get outcomeCaption(): string {
    switch (this.attempt.status) {
      case 'Completed':
        return this.attempt.failedCount > 0
          ? 'Every row was processed, but some could not be imported. Review them below and re-upload just those rows.'
          : 'Every row in your file was processed successfully.';
      case 'Failed':
        return this.attempt.failureReason ?? 'The import stopped before finishing.';
      case 'Canceled':
        return 'The import was canceled. Rows already applied before the cancel are kept.';
      default:
        return '';
    }
  }

  get outcomeClass(): string {
    switch (this.attempt.status) {
      case 'Completed':
        return this.attempt.failedCount > 0
          ? 'border-orange-200 bg-orange-50'
          : 'border-emerald-200 bg-emerald-50';
      case 'Failed':
        return 'border-red-100 bg-red-50';
      default:
        return 'border-gray-200 bg-gray-50';
    }
  }

  get outcomeIcon(): string {
    switch (this.attempt.status) {
      case 'Completed':
        return this.attempt.failedCount > 0 ? 'alert-circle-outline' : 'checkmark-circle-outline';
      case 'Failed':
        return 'close-circle-outline';
      default:
        return 'stop-circle-outline';
    }
  }

  rowStatusClass(status: ImportRowStatus): string {
    switch (status) {
      case 'Success':
        return 'border-emerald-200 text-emerald-600';
      case 'Updated':
        return 'border-indigo-200 text-indigo-600';
      case 'Skipped':
        return 'border-gray-300 text-gray-500';
      case 'Failed':
        return 'border-red-200 text-red-600';
      default:
        return 'border-gray-200 text-gray-400';
    }
  }

  trackByRowNumber(_index: number, row: CustomerImportRow): number {
    return row.rowNumber;
  }

  formatDateTime(iso: string | null): string {
    if (!iso) {
      return '—';
    }
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
