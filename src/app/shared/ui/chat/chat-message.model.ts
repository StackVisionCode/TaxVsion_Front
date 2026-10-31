import type { ChatEditPolicy } from './message-edit';

export type { ChatEditPolicy } from './message-edit';

/**
 * T-11 — tipos del hilo compartido (Chat, Support embebido, sala de meeting y ficha). Los módulos mapean sus DTO
 * a estos; el hilo no conoce de dónde vienen.
 */
/** F8b (D-22): rol dentro de un grupo. */
export type GroupRole = 'Owner' | 'Admin' | 'Member';

export interface ChatParticipant {
  userId: string;
  displayName: string;
  /** undefined = desconocida todavía; null = sin foto. */
  avatarFileId?: string | null;
  /** F8b: rol en el grupo y tipo de actor (los clientes nunca administran); ausentes en filas viejas. */
  role?: GroupRole;
  actorType?: string;
}

/**
 * F8d: estado del adjunto para la UI (Pending = escaneando; Unavailable = infectado o borrado).
 * T-20: UnderReview = la moderación lo dejó en revisión; Blocked = viola la política de contenido.
 */
export type AttachmentScanState = 'Pending' | 'Available' | 'Unavailable' | 'UnderReview' | 'Blocked';

/** Copy de cada estado no disponible; un estado disponible muestra el tamaño. */
export const ATTACHMENT_STATE_LABELS: Record<Exclude<AttachmentScanState, 'Available'>, string> = {
  Pending: 'Scanning…',
  UnderReview: 'Under review',
  Blocked: 'Blocked: this file goes against our content policy',
  Unavailable: 'Unavailable',
};

/** Estado del backend (AttachmentTracking) → estado de la UI. */
export function toAttachmentScanState(status: string | null | undefined): AttachmentScanState {
  switch (status) {
    case 'Pending':
      return 'Pending';
    case 'Available':
      return 'Available';
    case 'PendingReview':
      return 'UnderReview';
    case 'BlockedByPolicy':
      return 'Blocked';
    default:
      return 'Unavailable';
  }
}

/** F8d (T-26): una reacción agregada de un mensaje. */
export interface MessageReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
}

/** F8d (D-24, T-24): tope de emojis por persona y catálogo curado (llega con el historial). */
export interface ChatReactionPolicy {
  maxPerUser: number;
  catalog: string[];
}

/** F7 (D-27): estado del transcript de una nota de voz. */
export type VoiceNoteTranscriptState = 'NotRequested' | 'Processing' | 'Ready' | 'Failed' | 'Skipped';

/** F8 — GET .../messages/:messageId/edits: texto actual y versiones anteriores (de la original a la última). */
export interface MessageEditsDto {
  messageId: string;
  currentBody: string;
  editedAtUtc: string | null;
  versions: { revision: number; body: string; replacedAtUtc: string }[];
}

export interface ChatMessage {
  id: string;
  senderId: 'me' | 'them';
  /** Evento del sistema (p.ej. "Missed call", "Call ended 2:34") — se pinta centrado, no como burbuja. */
  isSystem?: boolean;
  text?: string;
  /** F8d: `status` del escaneo (Scanning/Unavailable) y tipo real para el visor; ausentes = disponible/desconocido. */
  attachment?: { name: string; size: string; fileId: string; status?: AttachmentScanState; contentType?: string | null };
  /** F8d (T-26): reacciones agregadas (quién, para el tooltip con foto). */
  reactions?: MessageReactionSummary[];
  /** Nota de voz: player en vez de tarjeta de archivo. F7: + transcript (estado y texto). */
  voiceNote?: {
    fileId: string;
    durationMs: number;
    waveform: number[];
    transcriptState?: VoiceNoteTranscriptState | null;
    transcriptText?: string | null;
  };
  /** F7 — mensaje System con archivo (transcript de una llamada): enlace "View transcript". */
  systemAttachmentFileId?: string;
  time: string;
  dateGroup: string;
  isEdited: boolean;
  /** F8: cuántas veces se editó (con `editPolicy` decide si aún se ofrece "Edit"). */
  editCount?: number;
  isDeleted: boolean;
  /** createdAtUtc crudo (ISO) — cursor para avanzar cotejos por fecha. */
  createdAtUtc: string;
  /** userId real del remitente (los ajenos): semilla del color y llave de su foto entre los participantes. */
  senderUserId?: string;
  senderName?: string;
  /** Foto que trajo el historial; respaldo si el remitente ya no está entre los participantes. */
  senderAvatarFileId?: string | null;
  /**
   * Cotejo de MI mensaje: 'sending' (reloj, aún sin ack) / 'failed' (no se envió, se puede reintentar) /
   * 'sent' (1 gris) / 'delivered' (2 grises) / 'read' (2 azules). undefined si es del otro.
   */
  status?: 'sending' | 'failed' | 'sent' | 'delivered' | 'read';
  /**
   * Clave estable del nodo en el DOM. Un mensaje optimista nace con un id temporal y al llegar el ack
   * pasa a tener el id real: `renderKey` no cambia, así la burbuja no se destruye y recrea (parpadeo).
   */
  renderKey?: string;
}

export interface MessageEdit {
  id: string;
  text: string;
}
