import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { RecycleBinItemResponse, formatBytes, formatDate } from '../../data-access/documents.model';

/**
 * Papelera del módulo Documents (estilo "Aether"): summary card + tabla.
 * Presentacional puro — los items vienen de DocumentsStore (GET
 * /storage/recycle-bin) vía el contenedor `documents-page`. El backend solo
 * soporta restaurar por archivo y vaciar TODA la papelera de una
 * (DELETE /storage/recycle-bin/empty) — no hay purga individual, por eso acá
 * no hay "Delete forever" por fila.
 */
@Component({
  selector: 'app-recycle-bin',
  imports: [CommonModule, ConfirmDialogComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './recycle-bin.component.html',
})
export class RecycleBinComponent {
  @Input() items: RecycleBinItemResponse[] = [];
  @Input() loading = false;
  @Input() error: string | null = null;

  @Output() back = new EventEmitter<void>();
  @Output() restore = new EventEmitter<string>();
  @Output() emptyBin = new EventEmitter<void>();

  readonly confirmEmptyOpen = signal(false);

  size(item: RecycleBinItemResponse): string {
    return formatBytes(item.sizeBytes);
  }

  deletedAt(item: RecycleBinItemResponse): string {
    return formatDate(item.softDeletedAtUtc);
  }

  confirmEmpty(): void {
    this.confirmEmptyOpen.set(false);
    this.emptyBin.emit();
  }
}
