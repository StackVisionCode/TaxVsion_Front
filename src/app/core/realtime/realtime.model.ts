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
