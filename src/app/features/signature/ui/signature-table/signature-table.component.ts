import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlacedField, RequestRules, VerificationChannel } from '../signature-request-panel/signature-wizard.model';

export type SignerStatus = 'pending' | 'signed' | 'rejected';

export interface Signer {
  name: string;
  initials: string;
  email: string;
  color: string;
  status: SignerStatus;
  /** ISO date string (YYYY-MM-DD), null while still pending/rejected. */
  signedAt: string | null;
  /** Canal de verificación preferido (wizard); opcional en los seeds antiguos. */
  channel?: VerificationChannel;
}

export type SignatureStatus = 'pending' | 'in-progress' | 'completed' | 'rejected';

export interface SignatureRequest {
  id: string;
  documentName: string;
  client: string;
  signers: Signer[];
  status: SignatureStatus;
  /** ISO date string (YYYY-MM-DD). */
  sentDate: string;
  /** ISO date string (YYYY-MM-DD). */
  dueDate: string;
  /** ISO date string (YYYY-MM-DD), null until the request is fully completed. */
  completedDate: string | null;
  notes: string;
  /** Data URL (PNG) of the preparer's own signature stamp, captured via app-signature-pad. Undefined/null if not added. */
  preparerSignatureDataUrl?: string | null;
  /** id del cliente elegido en el wizard (mock). */
  clientId?: string;
  /** Campos de firma colocados sobre el documento en el editor PDF del wizard. */
  signatureFields?: PlacedField[];
  /** Reglas de la solicitud (orden, canales, recordatorio…) definidas en el editor. */
  rules?: RequestRules;
}

/** Deriva el estado global de una solicitud a partir del estado de sus firmantes: todos firmados = completed, algún rechazo = rejected, alguno firmado = in-progress, ninguno = pending. */
export function deriveSignatureStatus(signers: Signer[]): SignatureStatus {
  if (signers.length === 0) {
    return 'pending';
  }
  if (signers.some(signer => signer.status === 'rejected')) {
    return 'rejected';
  }
  if (signers.every(signer => signer.status === 'signed')) {
    return 'completed';
  }
  if (signers.some(signer => signer.status === 'signed')) {
    return 'in-progress';
  }
  return 'pending';
}

/**
 * Tabla de solicitudes de firma (patrón "Aether", igual que campaign-table /
 * service-catalog): header en píldora `bg-[#FAF9F7]` con extremos
 * redondeados, columnas Document name / Client / Signers (avatares
 * superpuestos) / Status (chip outline) / Sent date / Completed date y un
 * menú fantasma "..." por fila con View / Resend reminder / Cancel request.
 * El click en la fila (fuera del menú) abre la vista previa de solo lectura.
 */
@Component({
  selector: 'app-signature-table',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-table.component.html',
})
export class SignatureTableComponent {
  @Input() requests: SignatureRequest[] = [];
  @Output() previewRequested = new EventEmitter<SignatureRequest>();
  @Output() resendRequested = new EventEmitter<SignatureRequest>();
  @Output() cancelRequested = new EventEmitter<SignatureRequest>();
  @Output() openLinkRequested = new EventEmitter<SignatureRequest>();

  readonly openMenuId = signal<string | null>(null);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="signature-menu"]')) {
      this.openMenuId.set(null);
    }
  }

  trackByRequestId(_index: number, request: SignatureRequest): string {
    return request.id;
  }

  visibleSigners(request: SignatureRequest): Signer[] {
    return request.signers.slice(0, 4);
  }

  extraSignersCount(request: SignatureRequest): number {
    return Math.max(0, request.signers.length - 4);
  }

  formatDate(iso: string | null): string {
    if (!iso) {
      return '—';
    }
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

  canCancel(request: SignatureRequest): boolean {
    return request.status === 'pending' || request.status === 'in-progress';
  }

  toggleMenu(request: SignatureRequest, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(this.openMenuId() === request.id ? null : request.id);
  }

  onRowClick(request: SignatureRequest): void {
    this.previewRequested.emit(request);
  }

  onViewClick(request: SignatureRequest, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.previewRequested.emit(request);
  }

  onResendClick(request: SignatureRequest, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.resendRequested.emit(request);
  }

  onCancelClick(request: SignatureRequest, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.cancelRequested.emit(request);
  }

  onOpenLinkClick(request: SignatureRequest, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.openLinkRequested.emit(request);
  }
}
