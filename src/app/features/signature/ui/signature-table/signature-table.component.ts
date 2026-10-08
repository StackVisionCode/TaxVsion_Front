import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlacedField, RequestRules, VerificationChannel } from '../signature-request-panel/signature-wizard.model';
import { SignatureCapabilities } from '../../data-access/signature-permissions';
import { SIGNATURE_STATUS_PILL, signatureStatusLabel } from '../../utils/signature-status.util';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { parseUtcDate } from '@shared/utils/utc-date.util';

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
  // F7 — estado de la copia inmediata que recibe este firmante al firmar.
  partialCopyRequestedAtUtc?: string | null;
  partialCopySentAtUtc?: string | null;
  partialCopyFailureReason?: string | null;
}

/**
 * Estado de UI de una solicitud. Espejo del SignatureRequestStatus real del
 * backend (draft/ready/in-progress/completed/rejected/canceled/expired);
 * 'pending' se conserva solo por el flujo demo del sign-page.
 */
export type SignatureStatus =
  | 'draft'
  | 'ready'
  | 'scheduled'
  | 'pending'
  | 'in-progress'
  | 'completed'
  | 'rejected'
  | 'canceled'
  | 'expired';

export interface SignatureRequestDocumentItem {
  id: string;
  order: number;
  title: string;
  originalFileId: string;
  hashPre: string | null;
  sealedFileId: string | null;
  hashPost: string | null;
  sealedAtUtc: string | null;
}

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
  documents: SignatureRequestDocumentItem[];
  /** fileId del PDF original en CloudStorage. */
  originalFileId?: string;
  /** fileId del PDF sellado (solo cuando completed). */
  sealedFileId?: string | null;
  /** fileId del certificado de finalización (solo cuando completed + generateCertificate). */
  certificateFileId?: string | null;
  /** Data URL (PNG) of the preparer's own signature stamp, captured via app-signature-pad. Undefined/null if not added. */
  preparerSignatureDataUrl?: string | null;
  /** FileId de la firma reutilizable del preparador a estampar (14.5); el preview baja su URL. */
  preparerSignatureFileId?: string | null;
  /** Nº de campos del preparador colocados (para mostrar en el preview de staff). */
  preparerFieldCount?: number;
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
  /** true si tiene ≥1 campo de firma/iniciales colocado — condición para poder enviarla. */
  hasSignatureField?: boolean;
  /** F2.5: borrador del actor logueado → se pinta "In preparation" en vez de "Draft". */
  isOwnedByActor?: boolean;
  /** F3: hora UTC programada; sólo cuando status === 'scheduled'. */
  scheduledSendAtUtc?: string | null;
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
  imports: [CommonModule, AvatarComponent, DropdownMenuComponent, MenuItemDirective, StatusPillComponent, StateBlockComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-table.component.html',
})
export class SignatureTableComponent {
  /**
   * B6 — hasta acá las acciones de fila se decidían SOLO por el estado de la solicitud. El estado
   * dice si la acción tiene sentido; el permiso, si esta persona puede hacerla. Hacían falta las
   * dos: "Cancel" y "Extend" se ofrecían a todos y el backend contestaba 403.
   */
  private readonly can = inject(SignatureCapabilities);

  @Input() requests: SignatureRequest[] = [];
  /** false = oculta la columna Client (módulo embebido en el perfil de un solo cliente). */
  @Input() showClient = true;
  @Output() previewRequested = new EventEmitter<SignatureRequest>();
  @Output() sendRequested = new EventEmitter<SignatureRequest>();
  @Output() resendRequested = new EventEmitter<SignatureRequest>();
  @Output() cancelRequested = new EventEmitter<SignatureRequest>();
  @Output() extendRequested = new EventEmitter<SignatureRequest>();
  /** Fijar o quitar el PIN del preparador de esa solicitud. */
  @Output() pinRequested = new EventEmitter<SignatureRequest>();
  /** Fijar la identidad del preparador o firmar como tal (Form 8879 §V). */
  @Output() preparerRequested = new EventEmitter<SignatureRequest>();
  @Output() downloadSealedRequested = new EventEmitter<SignatureRequest>();
  @Output() downloadCertificateRequested = new EventEmitter<SignatureRequest>();
  /** Reabrir el wizard rehidratado para seguir editando firmantes/campos (Draft/Ready). */
  @Output() continueRequested = new EventEmitter<SignatureRequest>();
  /** Editar solo la metadata de un borrador (modal ligero) (Draft/Ready). */
  @Output() editRequested = new EventEmitter<SignatureRequest>();
  /** Borrar en firme un borrador sin enviar (Draft/Ready). */
  @Output() deleteRequested = new EventEmitter<SignatureRequest>();

  readonly openMenuId = signal<string | null>(null);

  trackByRequestId(_index: number, request: SignatureRequest): string {
    return request.id;
  }

  visibleSigners(request: SignatureRequest): Signer[] {
    return request.signers.slice(0, 4);
  }

  extraSignersCount(request: SignatureRequest): number {
    return Math.max(0, request.signers.length - 4);
  }

  // Backend manda fechas UTC a veces sin 'Z': parseUtcDate es la única forma segura de leerlas.
  formatDate(iso: string | null): string {
    if (!iso) {
      return '—';
    }
    const d = parseUtcDate(iso);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  readonly statusLabel = signatureStatusLabel;
  readonly statusPill = SIGNATURE_STATUS_PILL;

  /** Cancelar/extender solo aplican a solicitudes YA ENVIADAS; un borrador sin enviar se borra, no se cancela. */
  private isSent(request: SignatureRequest): boolean {
    return request.status === 'pending' || request.status === 'in-progress';
  }

  canCancel(request: SignatureRequest): boolean {
    return this.isSent(request) && this.can.canCancel();
  }

  canExtend(request: SignatureRequest): boolean {
    // `signature.request.expire`, NO `request.cancel`: darle más días a una solicitud y matarla
    // son decisiones distintas y el backend las separa.
    return this.isSent(request) && this.can.canExtend();
  }

  /**
   * El PIN solo se puede tocar mientras la solicitud siga viva: una vez
   * completada, cancelada o vencida ya no hay firma que verificar.
   */
  /**
   * El PIN del preparador y la identidad del preparador SOLO se pueden fijar/cambiar mientras la
   * solicitud es editable (Draft/Ready) — igual que el dominio (`EnsureCanBeEdited`). Una vez enviada
   * (pending/in-progress) o cerrada, no se ofrece: fijarlo daba error en el backend.
   */
  canManagePin(request: SignatureRequest): boolean {
    return (request.status === 'draft' || request.status === 'ready') && this.can.canCreate();
  }

  /** Solo tiene sentido reenviar cuando la solicitud está en curso y queda alguien pendiente. */
  canResend(request: SignatureRequest): boolean {
    return (
      request.status === 'in-progress' &&
      request.signers.some(s => s.status === 'pending') &&
      this.can.canResend()
    );
  }

  hasSealed(request: SignatureRequest): boolean {
    return request.status === 'completed' && !!request.sealedFileId;
  }

  hasCertificate(request: SignatureRequest): boolean {
    return request.status === 'completed' && !!request.certificateFileId;
  }

  /** Menú abierto: la tabla reserva hueco inferior para que el panel no quede recortado. */
  onMenuOpenChange(request: SignatureRequest, open: boolean): void {
    if (open) {
      this.openMenuId.set(request.id);
    } else if (this.openMenuId() === request.id) {
      this.openMenuId.set(null);
    }
  }

  onRowClick(request: SignatureRequest): void {
    this.previewRequested.emit(request);
  }

  /**
   * Enviable desde el menu de la fila si es un borrador editable (Draft) o un historico Ready, Y
   * tiene al menos un campo de firma colocado. Un borrador incompleto (sin campos) no ofrece
   * Enviar: hay que terminarlo con "Continue editing". F2 colapso Ready en Draft como estado
   * estable; se mantiene `ready` por compatibilidad con filas historicas pre-F2.
   */
  canSendRow(request: SignatureRequest): boolean {
    return (
      (request.status === 'draft' || request.status === 'ready') &&
      !!request.hasSignatureField &&
      this.can.canCreate()
    );
  }

  /** Editar/borrar solo aplica a un borrador sin enviar (Draft/Ready). */
  canEditDraft(request: SignatureRequest): boolean {
    return (request.status === 'draft' || request.status === 'ready') && this.can.canCreate();
  }
}
