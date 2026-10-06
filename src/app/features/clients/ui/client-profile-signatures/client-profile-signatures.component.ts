import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnChanges, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PermissionService } from '@core/auth/permission.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { FileViewerComponent } from '@shared/ui/file-viewer/file-viewer.component';
import { FileViewerItem } from '@shared/ui/file-viewer/file-viewer.model';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { ClientSignaturesStore } from '../../data-access/client-signatures.store';
import { ClientSignatureItem } from '../../data-access/client-signatures.model';

/** Permisos del servicio Signature (BuildingBlocks.Authorization.SignaturePermissions). */
const REQUEST_READ = 'signature.request.read';
const REQUEST_CREATE = 'signature.request.create';
const REQUEST_CANCEL = 'signature.request.cancel';
const FILE_DOWNLOAD = 'cloudstorage.file.download';

/**
 * Pestaña "Signatures" del perfil de cliente: solicitudes de firma donde este cliente es
 * firmante (`GET /signature/requests?customerId=`, filtro por `Signer.MappedCustomerId`).
 *
 * Acciones básicas sobre el propio cliente: crear una solicitud nueva (emite `newRequest`; el
 * padre navega con el mismo deep link del menú Actions), ver el documento original en el visor
 * global y cancelar las que siguen abiertas. Editar/enviar/firmar se queda en el módulo
 * Signature (link "Open Signature").
 */
@Component({
  selector: 'app-client-profile-signatures',
  imports: [
    CommonModule,
    RouterModule,
    ConfirmDialogComponent,
    StateBlockComponent,
    StatusPillComponent,
    FileViewerComponent,
    TimeAgoPipe,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-signatures.component.html',
  styleUrl: './client-profile-signatures.component.css',
})
export class ClientProfileSignaturesComponent implements OnChanges {
  @Input() clientId = '';
  @Input() clientName = '';
  /** Lo resuelve el padre (deep link a `/signature?new=1&customerId=`). */
  @Output() newRequest = new EventEmitter<void>();

  readonly store = inject(ClientSignaturesStore);
  private readonly perms = inject(PermissionService);
  private readonly cloud = inject(CloudStorageUploadService);

  readonly canView = computed(() => this.perms.has(REQUEST_READ));
  readonly canCreate = computed(() => this.perms.has(REQUEST_CREATE));
  readonly canCancel = computed(() => this.perms.has(REQUEST_CANCEL));
  readonly canViewDocument = computed(() => this.perms.has(FILE_DOWNLOAD));

  readonly pendingCancel = signal<ClientSignatureItem | null>(null);
  readonly pendingCancelMessage = computed(() => {
    const item = this.pendingCancel();
    return item ? `"${item.title}" will be canceled and its signing links will stop working.` : '';
  });

  /** Visor global: documento original de la solicitud (URL presignada al mostrarlo). */
  readonly viewerOpen = signal(false);
  readonly viewerFiles = signal<FileViewerItem[]>([]);

  ngOnChanges(): void {
    if (this.clientId) {
      this.store.load(this.clientId);
    }
  }

  retry(): void {
    this.store.refresh();
  }

  viewDocument(item: ClientSignatureItem): void {
    if (!this.canViewDocument()) {
      return;
    }
    this.viewerFiles.set([this.cloud.viewerItemForId(item.originalFileId, item.title)]);
    this.viewerOpen.set(true);
  }

  requestCancel(item: ClientSignatureItem): void {
    this.pendingCancel.set(item);
  }

  confirmCancel(): void {
    const item = this.pendingCancel();
    if (item) {
      this.store.cancel(item);
    }
    this.pendingCancel.set(null);
  }

  /** Fecha más relevante según el estado de la solicitud. */
  dateLabel(item: ClientSignatureItem): { prefix: string; iso: string } {
    if (item.completedAtUtc) {
      return { prefix: 'Completed', iso: item.completedAtUtc };
    }
    if (item.sentAtUtc) {
      return { prefix: 'Sent', iso: item.sentAtUtc };
    }
    return { prefix: 'Created', iso: item.createdAtUtc };
  }

  trackById(_index: number, item: ClientSignatureItem): string {
    return item.id;
  }
}
