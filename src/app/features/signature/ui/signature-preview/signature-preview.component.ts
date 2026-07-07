import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SignatureRequest, SignatureStatus, SignerStatus } from '../signature-table/signature-table.component';

/**
 * Vista previa de solo lectura de una solicitud de firma (mismo patrón
 * "takeover" que campaign-preview, intercambiado con la lista vía
 * *ngIf/else en la página): encabezado con chip de estado y fechas, bloque
 * de datos del cliente y una lista de progreso por firmante (avatar,
 * nombre, email, icono de estado y fecha de firma si ya se completó). El
 * botón "Download signed document" es solo visual (sin acción real) y
 * únicamente se muestra cuando la solicitud completa está en estado
 * `completed`.
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

  formatDate(iso: string | null): string {
    if (!iso) {
      return '—';
    }
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  statusLabel(status: SignatureStatus): string {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'in-progress':
        return 'In Progress';
      case 'completed':
        return 'Completed';
      case 'rejected':
        return 'Rejected';
    }
  }

  statusChip(status: SignatureStatus): string {
    switch (status) {
      case 'completed':
        return 'border-emerald-200 text-emerald-600';
      case 'pending':
        return 'border-orange-200 text-orange-500';
      case 'in-progress':
        return 'border-indigo-200 text-indigo-500';
      case 'rejected':
        return 'border-red-200 text-red-500';
    }
  }

  statusDot(status: SignatureStatus): string {
    switch (status) {
      case 'completed':
        return 'bg-emerald-500';
      case 'pending':
        return 'bg-orange-500';
      case 'in-progress':
        return 'bg-indigo-500';
      case 'rejected':
        return 'bg-red-500';
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
    }
  }

  signedCount(request: SignatureRequest): number {
    return request.signers.filter(signer => signer.status === 'signed').length;
  }

  goBack(): void {
    this.back.emit();
  }
}
