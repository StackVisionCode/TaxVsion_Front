import type { MediaPolicyDto } from '@core/communication/media/media-policy.model';

/**
 * F6 (D-47) — contratos PÚBLICOS de invitado de Communication (sin JWT, vía Gateway `/communication`).
 * El token del enlace (`/meet/:token`) es la única credencial; cualquier token inválido/revocado/
 * expirado responde 404 uniforme (anti-enumeración) y el abuso 429.
 */

/** GET /communication/meetings/guest/:token/context */
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
  /** Política efectiva de la oficina (`meeting.guestsAllowed`). */
  guestsAllowed: boolean;
  /** El guest pasará por sala de espera (`meeting.guestsWaitingRoom`). */
  waitingRoom: boolean;
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
  invitationId: string;
}

/** 403 de `join-by-token` cuando la oficina no admite invitados externos. */
export const GUESTS_NOT_ALLOWED_CODE = 'Meeting.GuestsNotAllowed';
