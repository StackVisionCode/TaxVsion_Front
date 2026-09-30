import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SignatureRequest, Signer, SignerStatus } from '../signature-table/signature-table.component';
import { SignatureStore } from '../../data-access/signature.store';
import { SIGNATURE_STATUS_LABEL, SIGNATURE_STATUS_PILL, SignatureStatusPill } from '../../utils/signature-status.util';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';

/**
 * Vista previa de solo lectura de una solicitud de firma (mismo patrón
 * "takeover" que campaign-preview, intercambiado con la lista vía
 * *ngIf/else en la página): encabezado con chip de estado y fechas, bloque
 * de datos del cliente y una lista de progreso por firmante (avatar,
 * nombre, email, icono de estado y fecha de firma si ya se completó).
 * Con backend real: descarga del documento sellado y del certificado
 * (CloudStorage download-url, vía el padre) y reenvío de invitación por
 * firmante mientras la solicitud está en curso.
 */
@Component({
  selector: 'app-signature-preview',
  imports: [CommonModule, AvatarComponent, StatusPillComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-preview.component.html',
})
export class SignaturePreviewComponent {
  private readonly store = inject(SignatureStore);

  private _request: SignatureRequest | null = null;
  @Input() set request(value: SignatureRequest | null) {
    this._request = value;
    this.loadPreparerSignature(value);
  }
  get request(): SignatureRequest | null {
    return this._request;
  }

  /** URL presignada de la firma del preparador estampada (para mostrarla en el preview de staff). */
  readonly preparerSignatureUrl = signal<string | null>(null);

  /** true mientras el envío (Ready → InProgress) está en vuelo. */
  @Input() sending = false;
  @Output() back = new EventEmitter<void>();
  @Output() send = new EventEmitter<SignatureRequest>();
  @Output() downloadOriginal = new EventEmitter<SignatureRequest>();
  @Output() downloadSealed = new EventEmitter<SignatureRequest>();
  @Output() downloadCertificate = new EventEmitter<SignatureRequest>();
  @Output() resendSigner = new EventEmitter<{ request: SignatureRequest; signer: Signer }>();

  /** Solo una solicitud Ready (archivo ya Available, aún sin enviar) se puede enviar. */
  canSend(request: SignatureRequest): boolean {
    return request.status === 'ready';
  }

  formatDate(iso: string | null): string {
    if (!iso) {
      return '—';
    }
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  readonly statusLabel = SIGNATURE_STATUS_LABEL;
  readonly statusPill = SIGNATURE_STATUS_PILL;

  /**
   * Estado a mostrar por firmante: si la solicitud terminó (canceled/expired/rejected) y el firmante
   * seguía pendiente, no se muestra "Pending" — se refleja el cierre de la solicitud.
   */
  displaySignerStatus(request: SignatureRequest, signer: Signer): SignerStatus | 'canceled' {
    if (signer.status !== 'pending') {
      return signer.status;
    }
    if (request.status === 'expired') {
      return 'expired';
    }
    if (request.status === 'canceled' || request.status === 'rejected') {
      return 'canceled';
    }
    return 'pending';
  }

  signerStatusLabel(status: SignerStatus | 'canceled'): string {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'signed':
        return 'Signed';
      case 'rejected':
        return 'Rejected';
      case 'expired':
        return 'Expired';
      case 'canceled':
        return 'Canceled';
    }
  }

  signerStatusIcon(status: SignerStatus | 'canceled'): string {
    switch (status) {
      case 'pending':
        return 'hourglass-outline';
      case 'signed':
        return 'checkmark-circle-outline';
      case 'rejected':
        return 'close-circle-outline';
      case 'expired':
        return 'time-outline';
      case 'canceled':
        return 'ban-outline';
    }
  }

  signerStatusColor(status: SignerStatus | 'canceled'): string {
    switch (status) {
      case 'pending':
        return 'text-orange-500';
      case 'signed':
        return 'text-emerald-600';
      case 'rejected':
        return 'text-red-500';
      case 'expired':
        return 'text-amber-600';
      case 'canceled':
        return 'text-gray-400';
    }
  }

  /** Chip del firmante (reusa la paleta de estados de solicitud). */
  signerPill(status: SignerStatus | 'canceled'): SignatureStatusPill {
    switch (status) {
      case 'signed':
        return SIGNATURE_STATUS_PILL.completed;
      case 'rejected':
        return SIGNATURE_STATUS_PILL.rejected;
      case 'expired':
        return SIGNATURE_STATUS_PILL.expired;
      case 'pending':
        return SIGNATURE_STATUS_PILL.pending;
      case 'canceled':
        return SIGNATURE_STATUS_PILL.canceled;
    }
  }

  signedCount(request: SignatureRequest): number {
    return request.signers.filter(signer => signer.status === 'signed').length;
  }

  /** El documento original está disponible en cualquier estado mientras exista el archivo. */
  hasOriginal(request: SignatureRequest): boolean {
    return !!request.originalFileId;
  }

  hasSealed(request: SignatureRequest): boolean {
    return request.status === 'completed' && !!request.sealedFileId;
  }

  hasCertificate(request: SignatureRequest): boolean {
    return request.status === 'completed' && !!request.certificateFileId;
  }

  canResendSigner(request: SignatureRequest, signer: Signer): boolean {
    return request.status === 'in-progress' && signer.status === 'pending' && !!signer.id;
  }

  onResendSigner(request: SignatureRequest, signer: Signer): void {
    this.resendSigner.emit({ request, signer });
  }

  goBack(): void {
    this.back.emit();
  }

  /** Baja la URL de la firma del preparador si la solicitud la tiene, para mostrarla estampada. */
  private loadPreparerSignature(request: SignatureRequest | null): void {
    this.preparerSignatureUrl.set(null);
    const fileId = request?.preparerSignatureFileId;
    if (!fileId) {
      return;
    }
    this.store.getDownloadUrl(fileId).subscribe({
      next: url => this.preparerSignatureUrl.set(url),
      error: () => this.preparerSignatureUrl.set(null),
    });
  }
}
