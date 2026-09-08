import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CustomerImportAttempt,
  ImportStatus,
  importProgressPercent,
  importStatusLabel,
  isTerminalImport,
} from '../../data-access/client-imports.model';

/**
 * Historial de importaciones (`GET /customers/imports?page&size`).
 *
 * El endpoint devuelve un array plano sin total ni número de páginas, así que la
 * navegación es Prev/Next: `hasMore` lo calcula el store viendo si llegó la página completa.
 */
@Component({
  selector: 'app-client-import-history',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-import-history.component.html',
  styleUrl: './client-import-history.component.css',
})
export class ClientImportHistoryComponent {
  @Input() attempts: CustomerImportAttempt[] = [];
  @Input() loading = false;
  @Input() error: string | null = null;
  @Input() page = 1;
  @Input() hasMore = false;

  @Output() retryRequested = new EventEmitter<void>();
  @Output() pageChange = new EventEmitter<number>();
  @Output() attemptSelected = new EventEmitter<CustomerImportAttempt>();

  trackByAttemptId(_index: number, attempt: CustomerImportAttempt): string {
    return attempt.id;
  }

  statusLabel(attempt: CustomerImportAttempt): string {
    return importStatusLabel(attempt.status);
  }

  statusChipClass(status: ImportStatus): string {
    switch (status) {
      case 'Completed':
        return 'border-emerald-200 text-emerald-600';
      case 'Failed':
        return 'border-red-200 text-red-600';
      case 'Canceled':
        return 'border-gray-300 text-gray-500';
      case 'Canceling':
        return 'border-orange-200 text-orange-600';
      default:
        return 'border-indigo-200 text-indigo-600';
    }
  }

  /** Acción de la fila: seguir el progreso si sigue viva, ver el informe si ya terminó. */
  actionLabel(attempt: CustomerImportAttempt): string {
    return isTerminalImport(attempt.status) ? 'View report' : 'Track progress';
  }

  rowsLabel(attempt: CustomerImportAttempt): string {
    const percent = importProgressPercent(attempt);
    return percent === null
      ? `${attempt.processedRows} / —`
      : `${attempt.processedRows} / ${attempt.totalRows}`;
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
