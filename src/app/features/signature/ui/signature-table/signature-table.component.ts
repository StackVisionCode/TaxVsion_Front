import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlacedField, RequestRules, VerificationChannel } from '../signature-request-panel/signature-wizard.model';

export type SignerStatus = 'pending' | 'signed' | 'rejected' | 'expired';

export interface Signer {
  /** id real del firmante en el backend (resend por firmante); ausente en los datos demo del sign-page. */
  id?: string;
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

/**
 * Estado de UI de una solicitud. Espejo del SignatureRequestStatus real del
 * backend (draft/ready/in-progress/completed/rejected/canceled/expired);
 * 'pending' se conserva solo por el flujo demo del sign-page.
 */
export type SignatureStatus =
  | 'draft'
  | 'ready'
  | 'pending'
  | 'in-progress'
  | 'completed'
  | 'rejected'
  | 'canceled'
  | 'expired';

export interface SignatureRequest {
  id: string;
  documentName: string;
  client: string;
  signers: Signer[];
  status: SignatureStatus;
  /** ISO date string (YYYY-MM-DD); null mientras la solicitud sigue en Draft/Ready. */
  sentDate: string | null;
  /** ISO date string (YYYY-MM-DD) — fecha de expiración de la solicitud. */
  dueDate: string;
  /** ISO date string (YYYY-MM-DD), null until the request is fully completed. */
  completedDate: string | null;
  notes: string;
  /** Categoría legal (SignatureCategory del backend). */
  category?: string;
  /** fileId del PDF original en CloudStorage. */
  originalFileId?: string;
  /** fileId del PDF sellado (solo cuando completed). */
  sealedFileId?: string | null;
  /** fileId del certificado de finalización (solo cuando completed + generateCertificate). */
  certificateFileId?: string | null;
  /** Data URL (PNG) of the preparer's own signature stamp, captured via app-signature-pad. Undefined/null if not added. */
  preparerSignatureDataUrl?: string | null;
  /** id del cliente elegido en el wizard (mock). */
  clientId?: string;
  /** Campos de firma colocados sobre el documento en el editor PDF del wizard. */
  signatureFields?: PlacedField[];
  /** Reglas de la solicitud (orden, canales, recordatorio…) definidas en el editor. */
  rules?: RequestRules;
  /**
   * true = la solicitud exige PIN del preparador para firmar.
   *
   * Es la ÚNICA verificación de identidad que el backend impone al firmar
   * (`RequiresPractitionerPin && !signer.IsPinVerified`), y solo se activa
   * cuando el staff fija un PIN, así que la UI necesita saberlo para ofrecer
   * fijarlo o quitarlo.
   */
  requiresPractitionerPin?: boolean;
  /** Cuándo se fijó el PIN (el backend no devuelve el PIN en claro, nunca). */
  practitionerPinSetAtUtc?: string | null;
}

/** Deriva el estado global de una solicitud a partir del estado de sus firmantes: todos firmados = completed, algún rechazo = rejected, alguno firmado = in-progress, ninguno = pending. (Solo lo usa el flujo demo del sign-page; el estado real viene del backend.) */
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

/** Estados desde los que el staff todavía puede cancelar/extender (no terminales). */
export function isActionableStatus(status: SignatureStatus): boolean {
  return status === 'draft' || status === 'ready' || status === 'pending' || status === 'in-progress';
}

/**
 * Tabla de solicitudes de firma (patrón "Aether", igual que campaign-table /
 * service-catalog): header en píldora `bg-brand-white` con extremos
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
  @Output() extendRequested = new EventEmitter<SignatureRequest>();
  /** Fijar o quitar el PIN del preparador de esa solicitud. */
  @Output() pinRequested = new EventEmitter<SignatureRequest>();
  /** Fijar la identidad del preparador o firmar como tal (Form 8879 §V). */
  @Output() preparerRequested = new EventEmitter<SignatureRequest>();
  @Output() downloadSealedRequested = new EventEmitter<SignatureRequest>();
  @Output() downloadCertificateRequested = new EventEmitter<SignatureRequest>();

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
      case 'canceled':
        return 'border-gray-300 text-gray-500';
      case 'expired':
        return 'border-amber-200 text-amber-600';
    }
  }

  statusDot(status: SignatureStatus): string {
    switch (status) {
      case 'draft':
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
      case 'canceled':
        return 'bg-gray-400';
      case 'expired':
        return 'bg-amber-500';
    }
  }

  canCancel(request: SignatureRequest): boolean {
    return isActionableStatus(request.status);
  }

  canExtend(request: SignatureRequest): boolean {
    return isActionableStatus(request.status);
  }

  /**
   * El PIN solo se puede tocar mientras la solicitud siga viva: una vez
   * completada, cancelada o vencida ya no hay firma que verificar.
   */
  canManagePin(request: SignatureRequest): boolean {
    return isActionableStatus(request.status);
  }

  /** Solo tiene sentido reenviar cuando la solicitud está en curso y queda alguien pendiente. */
  canResend(request: SignatureRequest): boolean {
    return request.status === 'in-progress' && request.signers.some(s => s.status === 'pending');
  }

  hasSealed(request: SignatureRequest): boolean {
    return request.status === 'completed' && !!request.sealedFileId;
  }

  hasCertificate(request: SignatureRequest): boolean {
    return request.status === 'completed' && !!request.certificateFileId;
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

  onExtendClick(request: SignatureRequest, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.extendRequested.emit(request);
  }

  onPinClick(request: SignatureRequest, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.pinRequested.emit(request);
  }

  onPreparerClick(request: SignatureRequest, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.preparerRequested.emit(request);
  }

  onDownloadSealedClick(request: SignatureRequest, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.downloadSealedRequested.emit(request);
  }

  onDownloadCertificateClick(request: SignatureRequest, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.downloadCertificateRequested.emit(request);
  }
}
