/** Sobre de ack de todo comando cliente->server (send/edit/markRead/start_direct/...). */
export type SocketAck<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

/**
 * Sobre de todo evento server->cliente (SocketEnvelope<T> en Communication).
 * `eventId` es único por evento emitido y se usa para deduplicar re-entregas;
 * `correlationId` puede venir vacío en sockets, así que no se construye lógica
 * crítica sobre él.
 */
export interface SocketEnvelope<T> {
  eventId: string;
  correlationId: string;
  emittedAtUtc: string;
  sequence?: number;
  payload: T;
}

/**
 * `user.profile.changed` (Communication F5): un miembro del staff cambió su nombre o su foto.
 * Llega al cuarto del staff y al del propio usuario (nunca a los clientes del portal).
 * `avatarFileId` null = se quitó la foto.
 */
export interface UserProfileChangedEvent {
  userId: string;
  displayName?: string | null;
  avatarFileId?: string | null;
}

export const USER_PROFILE_CHANGED_EVENT = 'user.profile.changed';

/**
 * `session.expiring` (F3, INV-09): el servidor cierra el socket al `exp` del JWT y avisa ~60 s antes.
 * El cliente renueva el access token y manda `auth.refresh` con el nuevo; si falla, acepta el corte.
 */
export interface SessionExpiringEvent {
  expiresAtUtc: string;
  secondsLeft: number;
}

export const SESSION_EXPIRING_EVENT = 'session.expiring';

/** Ack de `auth.refresh`. */
export interface AuthRefreshResult {
  expiresAtUtc: string;
}

/**
 * F4 — `settings.changed`: cambió la configuración de Communication (plataforma u oficina). El front
 * refresca la política de media (`GET /communication/media-policy`) si la versión difiere.
 */
export interface SettingsChangedEvent {
  scope: 'platform' | 'tenant' | 'user' | string;
  version: number;
}

export const SETTINGS_CHANGED_EVENT = 'settings.changed';

/**
 * F6 — `meeting.invited` (room de usuario): me invitaron a una reunión. Con `status === 'Live'` el
 * CRM muestra "X invited you to a meeting in progress" con "Join"; en cualquier caso refresca la agenda.
 */
export interface MeetingInvitedEvent {
  meetingId: string;
  title: string;
  status: 'Scheduled' | 'Live';
  invitedByUserId: string;
  invitedByDisplayName: string;
}

export const MEETING_INVITED_EVENT = 'meeting.invited';

/** F6 (T-64) — `meeting.reminder` (room de usuario): la reunión agendada empieza en `minutesBefore` minutos. */
export interface MeetingReminderEvent {
  meetingId: string;
  title: string;
  scheduledForUtc: string;
  minutesBefore: number;
}

export const MEETING_REMINDER_EVENT = 'meeting.reminder';
