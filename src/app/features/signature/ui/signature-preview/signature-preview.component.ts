import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SignatureRequest, SignatureStatus, Signer, SignerStatus } from '../signature-table/signature-table.component';

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
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-preview.component.html',
})
export class SignaturePreviewComponent {
  @Input() request: SignatureRequest | null = null;
  @Output() back = new EventEmitter<void>();
  @Output() downloadSealed = new EventEmitter<SignatureRequest>();
  @Output() downloadCertificate = new EventEmitter<SignatureRequest>();
  @Output() resendSigner = new EventEmitter<{ request: SignatureRequest; signer: Signer }>();

  formatDate(iso: string | null): string {
    if (!iso) {
      return '—';
    }
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  statusLabel(status: SignatureStatus): string {
    switch (status) {
      case 'draft':
        return 'Draft';
      case 'ready':
        return 'Ready';
      case 'pending':
        return 'Pending';
      case 'in-progress':
        return 'In Progress';
      case 'completed':
        return 'Completed';
      case 'rejected':
        return 'Rejected';
      case 'canceled':
        return 'Canceled';
      case 'expired':
        return 'Expired';
    }
  }

  statusChip(status: SignatureStatus): string {
    switch (status) {
      case 'draft':
      case 'canceled':
        return 'border-gray-300 text-gray-500';
      case 'ready':
        return 'border-indigo-100 text-blue-600';
      case 'completed':
        return 'border-emerald-200 text-emerald-600';
      case 'pending':
        return 'border-orange-200 text-orange-500';
      case 'in-progress':
        return 'border-indigo-200 text-indigo-500';
      case 'rejected':
        return 'border-red-200 text-red-500';
      case 'expired':
        return 'border-amber-200 text-amber-600';
    }
  }

  statusDot(status: SignatureStatus): string {
    switch (status) {
      case 'draft':
      case 'canceled':
        return 'bg-gray-400';
      case 'ready':
        return 'bg-blue-500';
      case 'completed':
        return 'bg-emerald-500';
      case 'pending':
        return 'bg-orange-500';
      case 'in-progress':
        return 'bg-indigo-500';
      case 'rejected':
        return 'bg-red-500';
      case 'expired':
        return 'bg-amber-500';
    }
  }

  signerStatusLabel(status: SignerStatus): string {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'signed':
        return 'Signed';
      case 'rejected':
        return 'Rejected';
      case 'expired':
        return 'Expired';
    }
  }

  signerStatusIcon(status: SignerStatus): string {
    switch (status) {
      case 'pending':
        return 'hourglass-outline';
      case 'signed':
        return 'checkmark-circle-outline';
      case 'rejected':
        return 'close-circle-outline';
      case 'expired':
        return 'time-outline';
    }
  }

  signerStatusColor(status: SignerStatus): string {
    switch (status) {
      case 'pending':
        return 'text-orange-500';
      case 'signed':
        return 'text-emerald-600';
      case 'rejected':
        return 'text-red-500';
      case 'expired':
        return 'text-amber-600';
    }
  }

  /** Chip del firmante (reusa la paleta de estados de solicitud). */
  signerChip(status: SignerStatus): string {
    switch (status) {
      case 'signed':
        return this.statusChip('completed');
      case 'rejected':
        return this.statusChip('rejected');
      case 'expired':
        return this.statusChip('expired');
      case 'pending':
        return this.statusChip('pending');
    }
  }

  signedCount(request: SignatureRequest): number {
    return request.signers.filter(signer => signer.status === 'signed').length;
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
}
