import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { FileResponse, displayStatus, formatBytes, isFileReady } from '../../data-access/documents.model';

/**
 * Panel lateral de detalles de un archivo (no navega a otra página). Metadata +
 * acciones. El estado se muestra "amable" (Ready/Processing/Blocked), nunca el
 * FileStatus técnico.
 */
@Component({
  selector: 'app-file-details-panel',
  imports: [],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './file-details-panel.component.html',
  styleUrl: './file-details-panel.component.css',
})
export class FileDetailsPanelComponent {
  @Input({ required: true }) file!: FileResponse;
  @Input() locationText = '';
  @Output() closed = new EventEmitter<void>();
  @Output() download = new EventEmitter<FileResponse>();
  @Output() move = new EventEmitter<FileResponse>();
  @Output() remove = new EventEmitter<FileResponse>();

  get extension(): string {
    return this.file.originalName.split('.').pop()?.toUpperCase() ?? 'FILE';
  }

  get sizeLabel(): string {
    return formatBytes(this.file.sizeBytes);
  }

  get statusKind(): string {
    return displayStatus(this.file.status);
  }

  get statusLabel(): string {
    switch (this.statusKind) {
      case 'ready':
        return 'Ready';
      case 'blocked':
        return 'Blocked';
      default:
        return 'Processing';
    }
  }

  get ready(): boolean {
    return isFileReady(this.file.status);
  }

  get modifiedLabel(): string {
    const iso = this.file.scannedAtUtc ?? this.file.createdAtUtc;
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}
