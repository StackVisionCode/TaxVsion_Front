import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SignatureRequest, SignatureTableComponent, Signer } from '../../ui/signature-table/signature-table.component';
import { SignatureRequestPanelComponent } from '../../ui/signature-request-panel/signature-request-panel.component';
import { SignaturePreviewComponent } from '../../ui/signature-preview/signature-preview.component';
import { CreatedSignature, SignatureCreatorComponent } from '../../ui/signature-creator/signature-creator.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { toApiError } from '@core/models/api-error.model';
import { SignatureStore, SignatureStatusFilter } from '../../data-access/signature.store';
import {
  TOKEN_EXPIRATION_MAX_HOURS,
  TOKEN_EXPIRATION_MIN_HOURS,
} from '../../data-access/signature.model';

const STATUS_FILTERS: SignatureStatusFilter[] = [
  'All',
  'Draft',
  'Ready',
  'InProgress',
  'Completed',
  'Rejected',
  'Canceled',
  'Expired',
];

const STATUS_FILTER_LABEL: Record<SignatureStatusFilter, string> = {
  All: 'All',
  Draft: 'Draft',
  Ready: 'Ready',
  InProgress: 'In Progress',
  Completed: 'Completed',
  Rejected: 'Rejected',
  Canceled: 'Canceled',
  Expired: 'Expired',
};

/**
 * Página del módulo Signature conectada al backend real (TaxVision.Signature.Api
 * vía /signature): stats (listado + analytics summary) + filtro de estado y
 * paginación server-side + tabla de solicitudes hidratada con el detalle
 * (firmantes reales) + wizard de creación (takeover) + vista previa de solo
 * lectura. Acciones por fila según estado: cancelar (con motivo), extender la
 * expiración, reenviar invitaciones y descargar sealed/certificate vía
 * CloudStorage download-url. La búsqueda es client-side sobre la página cargada
 * (el endpoint de listado no expone `term`).
 */
@Component({
  selector: 'app-signature-page',
  imports: [
    CommonModule,
    FormsModule,
    SignatureTableComponent,
    SignatureRequestPanelComponent,
    SignaturePreviewComponent,
    SignatureCreatorComponent,
    PaginationComponent,
    ModalComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-page.component.html',
})
export class SignaturePageComponent {
  readonly store = inject(SignatureStore);

  readonly statusFilters = STATUS_FILTERS;
  readonly search = signal('');

  readonly isPanelOpen = signal(false);

  /** Generador de firmas (adaptado del CRM legado): modal + firma propia del preparador. */
  readonly isCreatorOpen = signal(false);
  readonly mySignature = signal<CreatedSignature | null>(null);

  /** Read-only detail takeover; plain signal set explicitly (not a computed over an @Input) so it stays safe to extend later. */
  readonly previewRequest = signal<SignatureRequest | null>(null);

  readonly toastMessage = signal<string | null>(null);

  // ---------- Modales de acción ----------
  readonly cancelTarget = signal<SignatureRequest | null>(null);
  readonly cancelReason = signal('');
  readonly extendTarget = signal<SignatureRequest | null>(null);
  readonly extendHours = signal(72);
  readonly actionBusy = signal(false);
  readonly actionError = signal('');

  readonly minExtendHours = TOKEN_EXPIRATION_MIN_HOURS;
  readonly maxExtendHours = TOKEN_EXPIRATION_MAX_HOURS;

  constructor() {
    this.store.refresh();
    this.store.loadStats();
  }

  /** Búsqueda client-side sobre la página cargada (el listado del backend no tiene `term`). */
  readonly visibleRequests = computed<SignatureRequest[]>(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) {
      return this.store.requests();
    }
    return this.store
      .requests()
      .filter(
        request =>
          request.documentName.toLowerCase().includes(query) ||
          request.client.toLowerCase().includes(query) ||
          request.signers.some(s => s.name.toLowerCase().includes(query) || s.email.toLowerCase().includes(query)),
      );
  });

  readonly completionRateLabel = computed(() => {
    const stats = this.store.stats();
    return stats ? `${Math.round(stats.completionRate * 100)}%` : '—';
  });

  statValue(value: number | undefined): string {
    return value === undefined ? '—' : this.formatNumber(value);
  }

  filterLabel(filter: SignatureStatusFilter): string {
    return STATUS_FILTER_LABEL[filter];
  }

  setFilter(filter: SignatureStatusFilter): void {
    this.search.set('');
    this.store.setStatusFilter(filter);
  }

  onSearchChange(value: string): void {
    this.search.set(value);
  }

  onPageChange(page: number): void {
    this.store.setPage(page);
  }

  retryLoad(): void {
    this.store.refresh();
    this.store.loadStats();
  }

  formatNumber(value: number): string {
    return value.toLocaleString('en-US');
  }

  openCreatePanel(): void {
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    this.isPanelOpen.set(false);
  }

  openCreator(): void {
    this.isCreatorOpen.set(true);
  }

  closeCreator(): void {
    this.isCreatorOpen.set(false);
  }

  handleSignatureCreated(signature: CreatedSignature): void {
    this.mySignature.set(signature);
    this.closeCreator();
    this.showToast('Signature saved');
  }

  /** El wizard ya creó y envió la solicitud (los firmantes reciben email del backend). */
  handleSent(): void {
    this.closePanel();
    this.showToast('Signature request sent — signers were notified by email');
  }

  openPreview(request: SignatureRequest): void {
    this.previewRequest.set(request);
  }

  closePreview(): void {
    this.previewRequest.set(null);
  }

  // ---------- Reenvíos ----------

  /** Acción de la fila: reenvía la invitación a todos los firmantes pendientes. */
  resendReminder(request: SignatureRequest): void {
    this.store.resendAllPending(request).subscribe({
      next: () => this.showToast(`Reminder resent for "${request.documentName}"`),
      error: err => this.showToast(toApiError(err).message),
    });
  }

  resendToSigner(event: { request: SignatureRequest; signer: Signer }): void {
    if (!event.signer.id) {
      return;
    }
    this.store.resendSigner(event.request.id, event.signer.id).subscribe({
      next: () => this.showToast(`Invitation resent to ${event.signer.name}`),
      error: err => this.showToast(toApiError(err).message),
    });
  }

  // ---------- Cancelar (con motivo) ----------

  openCancelModal(request: SignatureRequest): void {
    this.cancelReason.set('');
    this.actionError.set('');
    this.cancelTarget.set(request);
  }

  closeCancelModal(): void {
    if (this.actionBusy()) {
      return;
    }
    this.cancelTarget.set(null);
  }

  confirmCancel(): void {
    const target = this.cancelTarget();
    if (!target || this.actionBusy()) {
      return;
    }
    this.actionBusy.set(true);
    this.actionError.set('');
    this.store.cancel(target.id, this.cancelReason().trim() || null).subscribe({
      next: () => {
        this.actionBusy.set(false);
        this.cancelTarget.set(null);
        if (this.previewRequest()?.id === target.id) {
          this.previewRequest.set(null);
        }
        this.showToast(`Signature request "${target.documentName}" canceled`);
      },
      error: err => {
        this.actionBusy.set(false);
        this.actionError.set(toApiError(err).message);
      },
    });
  }

  // ---------- Extender expiración ----------

  openExtendModal(request: SignatureRequest): void {
    this.extendHours.set(72);
    this.actionError.set('');
    this.extendTarget.set(request);
  }

  closeExtendModal(): void {
    if (this.actionBusy()) {
      return;
    }
    this.extendTarget.set(null);
  }

  confirmExtend(): void {
    const target = this.extendTarget();
    const hours = Math.round(Number(this.extendHours()));
    if (!target || this.actionBusy()) {
      return;
    }
    if (!Number.isFinite(hours) || hours < TOKEN_EXPIRATION_MIN_HOURS || hours > TOKEN_EXPIRATION_MAX_HOURS) {
      this.actionError.set(`Hours must be between ${TOKEN_EXPIRATION_MIN_HOURS} and ${TOKEN_EXPIRATION_MAX_HOURS}.`);
      return;
    }
    this.actionBusy.set(true);
    this.actionError.set('');
    this.store.extendExpiration(target.id, hours).subscribe({
      next: () => {
        this.actionBusy.set(false);
        this.extendTarget.set(null);
        this.showToast(`Expiration extended by ${hours}h for "${target.documentName}"`);
      },
      error: err => {
        this.actionBusy.set(false);
        this.actionError.set(toApiError(err).message);
      },
    });
  }

  // ---------- Descargas (CloudStorage download-url) ----------

  downloadSealed(request: SignatureRequest): void {
    this.openDownload(request.sealedFileId ?? null, 'Signed document');
  }

  downloadCertificate(request: SignatureRequest): void {
    this.openDownload(request.certificateFileId ?? null, 'Certificate');
  }

  private openDownload(fileId: string | null, label: string): void {
    if (!fileId) {
      return;
    }
    this.store.getDownloadUrl(fileId).subscribe({
      next: url => {
        window.open(url, '_blank', 'noopener');
      },
      error: err => this.showToast(`${label}: ${toApiError(err).message}`),
    });
  }

  private showToast(message: string): void {
    this.toastMessage.set(message);
    setTimeout(() => {
      if (this.toastMessage() === message) {
        this.toastMessage.set(null);
      }
    }, 2500);
  }
}
