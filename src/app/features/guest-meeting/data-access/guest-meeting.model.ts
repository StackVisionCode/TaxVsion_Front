import type { MediaPolicyDto } from '@core/communication/media/media-policy.model';

/**
 * F6 (D-47) — contratos PÚBLICOS de invitado de Communication (sin JWT, vía Gateway `/communication`).
 * El token del enlace (`/meet/:token`) es la única credencial; cualquier token inválido/revocado/
 * expirado responde 404 uniforme (anti-enumeración) y el abuso 429.
 */

/** POST /communication/meetings/guest/context ({ token }) */
export interface GuestMeetingContext {
  meetingTitle: string;
  hostDisplayName: string;
  scheduledForUtc: string | null;
  durationMinutes: number | null;
  /** `Ended` cubre Ended/Cancelled/Expired. */
  status: 'Scheduled' | 'Live' | 'Ended';
  shortCode: string;
  /** Nombre que puso el host al invitar (prefill del campo de nombre). */
  inviteeName: string | null;
  /** La oficina y la reunión admiten externos (D-69). */
  guestsAllowed: boolean;
  /** El guest siempre espera a que lo admitan (D-67). */
  waitingRoom: boolean;
  /** Entró por el enlace compartible de la reunión (D-68), no por una invitación personal. */
  viaMeetingLink?: boolean;
  /** La reunión está bloqueada: con el enlace nadie nuevo puede pedir entrar. */
  isLocked?: boolean;
  /** Mismo DTO que `GET /communication/media-policy`, sin preferencias de usuario. */
  mediaPolicy: MediaPolicyDto;
}

/** POST /communication/meetings/join-by-token { token, displayName } */
export interface GuestJoinByTokenResponse {
  /** Ticket HS256 de corta vida para `auth.ticket` del socket. */
  shortLivedJoinTicket: string;
  meetingId: string;
  shortCode: string;
  tenantId: string;
  /** Null si entró por el enlace de la reunión (D-68). */
  invitationId: string | null;
  /** Identidad con la que el servidor me nombra en la reunión (la del ticket). */
  guestUserId: string;
}

/** 403 de `join-by-token` cuando la oficina no admite invitados externos. */
export const GUESTS_NOT_ALLOWED_CODE = 'Meeting.GuestsNotAllowed';
/** 403 de `join-by-token` con el enlace de la reunión cuando el host la bloqueó. */
export const MEETING_LOCKED_CODE = 'Meeting.Locked';
