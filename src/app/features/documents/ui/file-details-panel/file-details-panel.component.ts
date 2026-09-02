import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import {
  FileResponse,
  ShareLinkResponse,
  ShareVisibility,
  displayStatus,
  formatBytes,
  isFileReady,
} from '../../data-access/documents.model';

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
  @Input() shares: ShareLinkResponse[] = [];
  @Input() sharesLoading = false;
  @Output() closed = new EventEmitter<void>();
  @Output() download = new EventEmitter<FileResponse>();
  @Output() move = new EventEmitter<FileResponse>();
  @Output() remove = new EventEmitter<FileResponse>();
  @Output() revokeShare = new EventEmitter<string>();

  /** Solo se listan los links vigentes; los revocados/expirados no ensucian la vista. */
  get activeShares(): ShareLinkResponse[] {
    return this.shares.filter(s => s.status === 'Active');
  }

  accessLabel(visibility: ShareVisibility): string {
    switch (visibility) {
      case 'Public':
        return 'Anyone with the link';
      case 'ExternalRecipients':
        return 'External recipient';
      case 'TenantCustomers':
        return 'Client';
      case 'SpecificUsers':
        return 'Specific people';
      default:
        return 'Tenant members';
    }
  }

  expiryLabel(iso: string | null): string {
    if (!iso) {
      return 'No expiry';
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
    if (days <= 0) {
      return 'Expired';
    }
    if (days === 1) {
      return 'Expires tomorrow';
    }
    return days <= 30
      ? `Expires in ${days} days`
      : `Until ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

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
