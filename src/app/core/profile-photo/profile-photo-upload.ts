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

/** Desenlace de una subida: confirmada, descartada por el escaneo o sin respuesta a tiempo. */
export type PhotoUploadOutcome = 'updated' | 'failed' | 'timeout';

/** Un tick del sondeo. */
export type PhotoPollResult = 'updated' | 'failed' | 'pending';

/**
 * Sondea `read()` hasta que `classify` diga `updated` o `failed`; si se agotan los intentos, `timeout`.
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
    filter((result): result is 'updated' | 'failed' => result !== 'pending'),
    take(1),
    defaultIfEmpty<PhotoUploadOutcome, PhotoUploadOutcome>('timeout'),
  );
}
