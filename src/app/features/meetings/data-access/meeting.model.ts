/**
 * Modelos del módulo Meetings contra el servicio Communication (Fastify/TS,
 * `/communication` vía Gateway) — el mismo servicio que respalda el chat.
 * Fuente de verdad: `Communication/src/api/http/routes/meetings.route.ts` y
 * `meeting-invitations.route.ts` del backend (el README/Postman están
 * desactualizados). Los enums serializan como STRING.
 */

// ---------- Enums del backend ----------

/** `MeetingStatus` del dominio (meeting-enums.ts). `Expired` (F3): agendada que nunca arrancó. */
export type ApiMeetingStatus = 'Scheduled' | 'Live' | 'Ended' | 'Cancelled' | 'Expired';

/** F3 — por qué terminó (lo pone el servidor). */
export type MeetingEndReason = 'Host' | 'MaxDurationReached' | 'NoParticipants' | 'Offboarding' | 'Backfill';

/** Estrategia WebRTC del meeting — informativa para el front (Mesh | Sfu). */
export type MeetingStrategy = 'Mesh' | 'Sfu';

/** Estado visual usado por la UI (chips de la lista). */
export type MeetingUiStatus = 'upcoming' | 'live' | 'ended' | 'cancelled' | 'expired';

// ---------- GET /communication/meetings ----------

/**
 * Item de GET /communication/meetings?scope=upcoming|past&page&size.
 * OJO: el listado NO devuelve description, ni participantes con nombre (solo
 * el conteo de Joined), ni recordingFileId — solo transcriptFileId.
 */
export interface MeetingListItemResponse {
  id: string;
  title: string;
  status: ApiMeetingStatus;
  shortCode: string;
  strategy: MeetingStrategy;
  hostUserId: string;
  scheduledForUtc: string | null;
  startedAtUtc: string | null;
  endedAtUtc: string | null;
  /** F3 (T-40) — duración programada (informativa), tope de la oficina, corte, motivo y duración real. */
  scheduledDurationMinutes?: number | null;
  maxDurationMinutes?: number | null;
  endsAtUtc?: string | null;
  endReason?: MeetingEndReason | null;
  /** Duración real en segundos (solo terminadas); null si no aplica. */
  durationSeconds?: number | null;
  continuationOfMeetingId?: string | null;
  joinedParticipantsCount: number;
  /** FileId de CloudStorage del transcript (solo meetings pasadas que lo tengan). */
  transcriptFileId: string | null;
  /** F7 — estado de la grabación (`Recording`/`Processing`/`Ready`/`Failed`…); null = no se grabó. */
  recordingState?: string | null;
}

/** Página del listado — Communication devuelve items/page/size/totalCount (sin hasMore). */
export interface MeetingsPageResponse {
  items: MeetingListItemResponse[];
  page: number;
  size: number;
  totalCount: number;
}

/** Alcance del listado: upcoming = Scheduled+Live, past = Ended+Cancelled. */
export type MeetingsScope = 'upcoming' | 'past';

/**
 * GET /communication/meetings/stats — contadores para las tarjetas del dashboard, calculados en el
 * backend sobre TODOS los meetings del usuario (no la página cargada), así reflejan el total real.
 */
export interface MeetingStatsResponse {
  today: number;
  thisWeek: number;
  liveNow: number;
  transcriptsAvailable: number;
}

// ---------- POST /communication/meetings ----------

export interface CreateMeetingRequest {
  title: string;
  description?: string;
  /** 2..100 — default backend: 4. */
  maxParticipants?: number;
  passcode?: string;
  requireWaitingRoom?: boolean;
  /** ISO UTC; si se omite el meeting queda "instantáneo" (sin agenda). */
  scheduledForUtc?: string;
  recordingRequested?: boolean;
  /** F3 — informativa (≤ máximo de la oficina; 400 `Meeting.InvalidDuration` si lo supera). El corte real es `endsAtUtc`. */
  scheduledDurationMinutes?: number;
}

export interface CreateMeetingResponse {
  meetingId: string;
  shortCode: string;
  requiresPasscode: boolean;
}

/** F3 — POST /communication/meetings/{id}/continue (host o cohost de una reunión terminada). */
export interface ContinueMeetingResponse {
  meetingId: string;
  shortCode: string;
  requiresPasscode: boolean;
  invitationsCreated: number;
}

/** F3 — GET /communication/meetings/limits: límites efectivos de la oficina (plataforma > plan > oficina). */
export interface MeetingLimits {
  maxDurationMinutes: number;
  defaultDurationMinutes: number;
  maxParticipants: number;
  guestsAllowed: boolean;
}

/** Pasos habituales del selector de duración; se recortan al máximo de la oficina. */
const MEETING_DURATION_STEPS_MINUTES: readonly number[] = [15, 30, 45, 60, 90, 120, 180, 240];

/**
 * Opciones del selector "Duration (informational)": los pasos que caben en el máximo de la
 * oficina más el propio máximo y el valor por defecto, sin repetidos y ordenadas.
 */
export function buildDurationOptions(limits: MeetingLimits): number[] {
  const max = Math.max(1, Math.floor(limits.maxDurationMinutes));
  const fallback = Math.min(max, Math.max(1, Math.floor(limits.defaultDurationMinutes)));
  const options = new Set<number>(MEETING_DURATION_STEPS_MINUTES.filter(m => m <= max));
  options.add(fallback);
  options.add(max);
  return [...options].sort((a, b) => a - b);
}

// ---------- Lifecycle (host-only en el backend) ----------

export interface StartMeetingResponse {
  startedAtUtc: string;
}

export interface EndMeetingResponse {
  endedAtUtc: string;
  durationSeconds: number;
}

// ---------- Invitaciones ----------

/** Kind del invitee al CREAR (minúsculas en el request Zod del backend). */
export type MeetingInviteeKind = 'employee' | 'customer' | 'external';

export interface MeetingInviteeInput {
  kind: MeetingInviteeKind;
  userId?: string;
  /** Solo customer: el backend lo resuelve a su userId de portal para la lista + realtime. */
  customerId?: string;
  email?: string;
  name?: string;
}

/**
 * POST /communication/meetings/{id}/invitations — el joinUrl con el token
 * completo SOLO se expone en esta respuesta (nunca se re-expone después).
 */
export interface CreatedMeetingInvitation {
  id: string;
  tokenPreview: string;
  expiresAt: string;
  inviteeEmail: string | null;
  joinUrl: string;
}

export interface CreateMeetingInvitationsResponse {
  invitations: CreatedMeetingInvitation[];
}

/**
 * GET /communication/meetings/{id}/invitations — kind en PascalCase acá. F6 (D-48): el token de un
 * usuario con cuenta es REUTILIZABLE (`useCount`, `firstUsedAt`/`lastUsedAt`); el de un guest es de un
 * solo uso (`usedAt`). `closedAt` = la reunión terminó/se canceló/expiró. Opcionales por backends viejos.
 */
export interface MeetingInvitationListItem {
  id: string;
  inviteeKind: 'Employee' | 'Customer' | 'External';
  inviteeEmail: string | null;
  inviteeUserId: string | null;
  inviteeName: string | null;
  expiresAt: string;
  usedAt: string | null;
  firstUsedAt?: string | null;
  lastUsedAt?: string | null;
  useCount?: number;
  revokedAt: string | null;
  closedAt?: string | null;
  createdAt: string;
}

export interface ListMeetingInvitationsResponse {
  invitations: MeetingInvitationListItem[];
}

// ---------- Directorio (shape mínimo replicado, sin imports cross-feature) ----------

/** GET /communication/directory/employees?q=&limit= (limit ≤ 25). */
export interface MeetingEmployeeEntry {
  userId: string;
  displayName: string;
  email: string;
  isActive: boolean;
  /** Foto del empleado; null = sin foto. */
  avatarFileId?: string | null;
}

/** POST /communication/directory/customers/search ({ q, limit }) — devuelve customerId, NO userId. */
export interface MeetingCustomerEntry {
  customerId: string;
  displayName: string;
  email: string;
  isActive: boolean;
  /** Foto de la ficha del cliente; null = sin foto. */
  avatarFileId?: string | null;
}

// ---------- Modelos de UI ----------

/** Invitado elegido en el panel (chip) antes de mandar las invitaciones. */
export interface MeetingInviteeDraft {
  kind: MeetingInviteeKind;
  /** Solo para employees (id de Auth). */
  userId: string | null;
  /** Solo para customers: el backend lo resuelve a su userId de portal (lista + realtime). */
  customerId?: string | null;
  email: string | null;
  name: string;
  /** Solo para el chip (no viaja al backend). */
  avatarFileId?: string | null;
}

/** Valor que emite el panel de creación; el store orquesta las llamadas. */
export interface MeetingFormValue {
  title: string;
  description: string;
  /** ISO UTC o null para meeting instantáneo. */
  scheduledForUtc: string | null;
  invitees: MeetingInviteeDraft[];
  /** Sala de espera: el host admite/deniega a cada participante antes de entrar. */
  requireWaitingRoom: boolean;
  /** Passcode opcional para unirse (4..120 chars); null/'' = sin passcode. */
  passcode: string | null;
  /** Pide grabar la reunión (con consentimiento de los participantes). */
  recordingRequested: boolean;
  /** F3 — duración programada, informativa; null = que el backend aplique la de la oficina. */
  scheduledDurationMinutes: number | null;
}

/** Fila de la lista, derivada de MeetingListItemResponse + usuario actual. */
export interface MeetingItem {
  id: string;
  title: string;
  shortCode: string;
  apiStatus: ApiMeetingStatus;
  status: MeetingUiStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Duración real (`durationSeconds` del backend, o start→end) para meetings terminadas; null si no aplica. */
  durationMinutes: number | null;
  /** F3 — motivo corto del fin ("Time limit"); null cuando no aporta. */
  endReasonLabel: string | null;
  joinedCount: number;
  transcriptFileId: string | null;
  /** F7 — estado de la grabación; null/ausente = no se grabó. */
  recordingState?: string | null;
  hostUserId: string;
  /** El usuario logueado es el host: habilita Start/End/Reschedule/Cancel/invitaciones. */
  isHost: boolean;
}

const STATUS_TO_UI: Record<ApiMeetingStatus, MeetingUiStatus> = {
  Scheduled: 'upcoming',
  Live: 'live',
  Ended: 'ended',
  Cancelled: 'cancelled',
  Expired: 'expired',
};

/** Etiqueta corta del motivo de fin (misma tabla que `endReasonShortLabel` de core, sin importar core desde el modelo). */
const END_REASON_LABELS: Partial<Record<MeetingEndReason, string>> = {
  MaxDurationReached: 'Time limit',
  NoParticipants: 'Everyone left',
};

export function toMeetingItem(response: MeetingListItemResponse, currentUserId: string | null): MeetingItem {
  let durationMinutes: number | null = null;
  if (response.status === 'Ended' && typeof response.durationSeconds === 'number' && response.durationSeconds > 0) {
    durationMinutes = Math.max(1, Math.round(response.durationSeconds / 60)); // duración real del backend (F3)
  } else if (response.startedAtUtc && response.endedAtUtc) {
    const ms = new Date(response.endedAtUtc).getTime() - new Date(response.startedAtUtc).getTime();
    durationMinutes = Math.max(1, Math.round(ms / 60_000));
  }
  const endReasonLabel = response.status === 'Ended' && response.endReason ? (END_REASON_LABELS[response.endReason] ?? null) : null;
  return {
    id: response.id,
    title: response.title,
    shortCode: response.shortCode,
    apiStatus: response.status,
    status: STATUS_TO_UI[response.status] ?? 'upcoming',
    scheduledAt: response.scheduledForUtc,
    startedAt: response.startedAtUtc,
    endedAt: response.endedAtUtc,
    durationMinutes,
    endReasonLabel,
    joinedCount: response.joinedParticipantsCount,
    transcriptFileId: response.transcriptFileId,
    recordingState: response.recordingState ?? null,
    hostUserId: response.hostUserId,
    isHost: currentUserId !== null && response.hostUserId === currentUserId,
  };
}

// ---------- Ficha del meeting (GET /meetings/:id/summary y /events) ----------

export interface MeetingSummaryParticipant {
  userId: string;
  displayName: string;
  avatarFileId: string | null;
  role: 'Host' | 'Cohost' | 'Attendee';
  actorType: string;
  firstJoinedAtUtc: string | null;
  lastLeftAtUtc: string | null;
  /** Suma de todas sus sesiones (sale y vuelve). */
  attendedSeconds: number;
  sessions: number;
  speakingSeconds: number;
  screenShares: number;
  handsRaised: number;
}

export interface MeetingSummaryInvitee {
  kind: 'Employee' | 'Customer' | 'External';
  displayName: string;
}

export interface MeetingSummaryResponse {
  meeting: {
    id: string;
    title: string;
    description: string | null;
    status: ApiMeetingStatus;
    shortCode: string;
    hostUserId: string;
    hostName: string | null;
    scheduledForUtc: string | null;
    scheduledDurationMinutes: number | null;
    startedAtUtc: string | null;
    endedAtUtc: string | null;
    durationSeconds: number | null;
    endReason: MeetingEndReason | null;
    maxParticipants: number;
    transcriptFileId: string | null;
    recordingState: string | null;
  };
  participants: MeetingSummaryParticipant[];
  /** Solo host/cohost: invitados que no entraron. */
  invitedNotJoined: MeetingSummaryInvitee[];
  totals: { attendees: number; peakConcurrent: number; screenShares: number; handsRaised: number; reactions: number };
}

export interface MeetingEventItem {
  seq: number;
  at: string;
  type: string;
  actorUserId: string | null;
  targetUserId: string | null;
  payload: Record<string, unknown> | null;
}

export interface MeetingEventsPageResponse {
  items: MeetingEventItem[];
  nextAfterSeq: number | null;
}

/** F8a (D-01) — GET /meetings/:id/chat: chat de la sala en solo lectura para quien participó. */
export interface MeetingChatMessage {
  id: string;
  senderId: string;
  senderDisplayName: string;
  senderAvatarFileId?: string | null;
  kind: 'Text' | 'Attachment' | 'System';
  body: string | null;
  attachmentFileId: string | null;
  isDeleted: boolean;
  isEdited: boolean;
  createdAtUtc: string;
}

export interface MeetingChatHistoryResponse {
  conversationId: string | null;
  isArchived: boolean;
  items: MeetingChatMessage[];
  nextBeforeUtc: string | null;
}
