/**
 * Modelos del módulo Meetings contra el servicio Communication (Fastify/TS,
 * `/communication` vía Gateway) — el mismo servicio que respalda el chat.
 * Fuente de verdad: `Communication/src/api/http/routes/meetings.route.ts` y
 * `meeting-invitations.route.ts` del backend (el README/Postman están
 * desactualizados). Los enums serializan como STRING.
 */

// ---------- Enums del backend ----------

/** `MeetingStatus` del dominio (meeting-enums.ts). */
export type ApiMeetingStatus = 'Scheduled' | 'Live' | 'Ended' | 'Cancelled';

/** Estrategia WebRTC del meeting — informativa para el front (Mesh | Sfu). */
export type MeetingStrategy = 'Mesh' | 'Sfu';

/** Estado visual usado por la UI (chips de la lista). */
export type MeetingUiStatus = 'upcoming' | 'live' | 'ended' | 'cancelled';

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
  joinedParticipantsCount: number;
  /** FileId de CloudStorage del transcript (solo meetings pasadas que lo tengan). */
  transcriptFileId: string | null;
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
}

export interface CreateMeetingResponse {
  meetingId: string;
  shortCode: string;
  requiresPasscode: boolean;
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

/** GET /communication/meetings/{id}/invitations — kind en PascalCase acá. */
export interface MeetingInvitationListItem {
  id: string;
  inviteeKind: 'Employee' | 'Customer' | 'External';
  inviteeEmail: string | null;
  inviteeUserId: string | null;
  inviteeName: string | null;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
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
}

/** GET /communication/directory/customers?q=&limit= — devuelve customerId, NO userId. */
export interface MeetingCustomerEntry {
  customerId: string;
  displayName: string;
  email: string;
  isActive: boolean;
}

// ---------- Modelos de UI ----------

/** Invitado elegido en el panel (chip) antes de mandar las invitaciones. */
export interface MeetingInviteeDraft {
  kind: MeetingInviteeKind;
  /** Solo para employees (id de Auth); customers van por email. */
  userId: string | null;
  email: string | null;
  name: string;
}

/** Valor que emite el panel de creación; el store orquesta las llamadas. */
export interface MeetingFormValue {
  title: string;
  description: string;
  /** ISO UTC o null para meeting instantáneo. */
  scheduledForUtc: string | null;
  invitees: MeetingInviteeDraft[];
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
  /** Duración real (start→end) para meetings terminadas; null si no aplica. */
  durationMinutes: number | null;
  joinedCount: number;
  transcriptFileId: string | null;
  hostUserId: string;
  /** El usuario logueado es el host: habilita Start/End/Reschedule/Cancel/invitaciones. */
  isHost: boolean;
}

const STATUS_TO_UI: Record<ApiMeetingStatus, MeetingUiStatus> = {
  Scheduled: 'upcoming',
  Live: 'live',
  Ended: 'ended',
  Cancelled: 'cancelled',
};

export function toMeetingItem(response: MeetingListItemResponse, currentUserId: string | null): MeetingItem {
  let durationMinutes: number | null = null;
  if (response.startedAtUtc && response.endedAtUtc) {
    const ms = new Date(response.endedAtUtc).getTime() - new Date(response.startedAtUtc).getTime();
    durationMinutes = Math.max(1, Math.round(ms / 60_000));
  }
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
    joinedCount: response.joinedParticipantsCount,
    transcriptFileId: response.transcriptFileId,
    hostUserId: response.hostUserId,
    isHost: currentUserId !== null && response.hostUserId === currentUserId,
  };
}

// ---------- Helpers visuales (mismo criterio que features/task) ----------

const AVATAR_COLORS = ['bg-brand-bold', 'bg-sky-700', 'bg-brand-ink', 'bg-slate-500', 'bg-indigo-400'];

export function meetingInitialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function meetingAvatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
