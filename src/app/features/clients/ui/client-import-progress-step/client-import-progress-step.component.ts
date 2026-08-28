import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CustomerImportAttempt,
  ImportStatus,
  importProgressPercent,
  importStatusLabel,
  isCancelableImport,
} from '../../data-access/client-imports.model';

/**
 * Paso 2 del wizard: progreso real de la importación.
 *
 * El POST sólo devuelve 202 (el trabajo lo hace un worker tras el escaneo del archivo en
 * CloudStorage), así que todo lo que se ve acá sale del sondeo de `GET /customers/imports/{id}`.
 */
@Component({
  selector: 'app-client-import-progress-step',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-import-progress-step.component.html',
  styleUrl: './client-import-progress-step.component.css',
})
export class ClientImportProgressStepComponent {
  @Input({ required: true }) attempt!: CustomerImportAttempt;
  @Input() canceling = false;
  @Input() cancelError: string | null = null;
  @Input() pollError: string | null = null;

  @Output() cancelRequested = new EventEmitter<void>();
  @Output() retryPollRequested = new EventEmitter<void>();

  /** null mientras el worker no haya fijado `totalRows` → barra indeterminada. */
  get percent(): number | null {
    return importProgressPercent(this.attempt);
  }

  get canCancel(): boolean {
    return isCancelableImport(this.attempt.status);
  }

  get statusLabel(): string {
    return importStatusLabel(this.attempt.status);
  }

  /** Descripción de cada estado, tomada del ciclo de vida real del aggregate. */
  get statusCaption(): string {
    switch (this.attempt.status) {
      case 'Queued':
        return 'The file was uploaded and is waiting to be scanned and picked up.';
      case 'Validating':
        return 'Reading and validating the rows in your file.';
      case 'Applying':
        return 'Creating and updating clients from the validated rows.';
      case 'Canceling':
        return 'Cancel requested. Waiting for the worker to stop.';
      default:
        return '';
    }
  }

  statusChipClass(status: ImportStatus): string {
    return status === 'Canceling' ? 'border-orange-200 text-orange-600' : 'border-indigo-200 text-indigo-600';
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
