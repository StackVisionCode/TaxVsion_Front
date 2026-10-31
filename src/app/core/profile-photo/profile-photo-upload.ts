import { Observable, catchError, defaultIfEmpty, filter, map, of, switchMap, take, timer } from 'rxjs';

/**
 * Piezas comunes de "subir foto → esperar al antivirus" (perfil propio y foto del cliente en Client 360).
 * El PUT responde 202 con el `fileId` pendiente y se sondea la lectura hasta que quede confirmado o descartado.
 */

/** Sondeo tras el 202 (escaneo antivirus asíncrono), igual que el logo de la oficina. */
export const PHOTO_POLL_DELAY_MS = 2000;
export const PHOTO_POLL_INTERVAL_MS = 2500;
export const PHOTO_POLL_MAX_TRIES = 10;

/** Fase de la foto mientras se trabaja con ella. */
export type PhotoStatus = 'idle' | 'preparing' | 'uploading' | 'processing' | 'removing';

/**
 * Desenlace de una subida: confirmada, descartada por el escaneo o sin respuesta a tiempo.
 * T-20: `under_review` = la moderación la retuvo para revisión humana; `blocked` = viola la política.
 */
export type PhotoUploadOutcome = 'updated' | 'failed' | 'timeout' | 'under_review' | 'blocked';

/** Un tick del sondeo. */
export type PhotoPollResult = 'updated' | 'failed' | 'pending' | 'under_review' | 'blocked';

/** T-20: estado de moderación que mandan /auth/me y el detalle del cliente para la última foto subida. */
export type PhotoModerationStatus = 'under_review' | 'blocked';

export const PHOTO_UNDER_REVIEW_MESSAGE =
  'This photo is under review against our content policy. It will appear once approved.';
export const PHOTO_BLOCKED_MESSAGE = 'This photo goes against our content policy. Please choose a different one.';

/** La moderación de `fileId`, si la hay (otra foto anterior no cuenta). */
export function photoModerationOf(
  status: PhotoModerationStatus | null | undefined,
  moderationFileId: string | null | undefined,
  fileId: string,
): PhotoModerationStatus | null {
  return status && moderationFileId === fileId ? status : null;
}

/** Aviso persistente junto a la foto (revisión o bloqueo de la última subida); null si no hay. */
export function photoModerationNotice(status: PhotoModerationStatus | null | undefined): string | null {
  return status === 'under_review' ? PHOTO_UNDER_REVIEW_MESSAGE : status === 'blocked' ? PHOTO_BLOCKED_MESSAGE : null;
}

/**
 * Sondea `read()` hasta un veredicto (`updated`, `failed`, `under_review` o `blocked`); si se agotan los
 * intentos, `timeout`.
 * Un fallo de lectura cuenta como "todavía pendiente" (el siguiente tick reintenta).
 */
export function pollPhotoOutcome<T>(
  read: () => Observable<T>,
  classify: (state: T | null) => PhotoPollResult,
): Observable<PhotoUploadOutcome> {
  return timer(PHOTO_POLL_DELAY_MS, PHOTO_POLL_INTERVAL_MS).pipe(
    take(PHOTO_POLL_MAX_TRIES),
    switchMap(() => read().pipe(catchError(() => of(null)))),
    map(state => classify(state)),
    filter((result): result is Exclude<PhotoPollResult, 'pending'> => result !== 'pending'),
    take(1),
    defaultIfEmpty<PhotoUploadOutcome, PhotoUploadOutcome>('timeout'),
  );
}
