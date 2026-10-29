import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, catchError, defer, finalize, from, switchMap, takeUntil, tap, throwError } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import {
  PROFILE_PHOTO_MESSAGES,
  PROFILE_PHOTO_PREPARER,
  ProfilePhotoError,
} from '@core/profile-photo/profile-photo-image.util';
import {
  PhotoPollResult,
  PhotoStatus,
  PhotoUploadOutcome,
  pollPhotoOutcome,
} from '@core/profile-photo/profile-photo-upload';
import { ClientsStore } from './clients.store';
import { CustomerDetailResponse } from './clients.model';

export const CLIENT_PHOTO_FAILED_MESSAGE = "We couldn't use that photo. Try another image.";
export const CLIENT_PHOTO_STILL_PROCESSING_MESSAGE = "The client's photo is still being checked. It will appear shortly.";

/**
 * Un tick del sondeo sobre el detalle del cliente: `updated` si `fileId` ya es la foto confirmada,
 * `pending` mientras siga pendiente (o si la lectura falló) y `failed` si se descartó o la reemplazó otra.
 */
export function classifyCustomerAvatarPoll(
  detail: Pick<CustomerDetailResponse, 'avatarFileId' | 'pendingAvatarFileId' | 'avatarUploadStatus'> | null,
  fileId: string,
): PhotoPollResult {
  if (!detail) {
    return 'pending';
  }
  if (detail.avatarFileId === fileId) {
    return 'updated';
  }
  if (detail.pendingAvatarFileId === fileId) {
    return 'pending';
  }
  // Backend sin `pendingAvatarFileId`: solo queda el estado.
  if (detail.pendingAvatarFileId === undefined && detail.avatarUploadStatus === 'processing') {
    return 'pending';
  }
  return 'failed';
}

/**
 * Foto del cliente desde Client 360 (decisión 2 del dueño: el preparador puede ponerla). Mismo flujo que
 * la foto propia: preparar en el navegador → PUT /customers/{id}/avatar (202) → sondear el detalle hasta
 * que el antivirus la confirme. Se provee en el componente: el estado es de la cabecera que lo muestra.
 */
@Injectable()
export class ClientPhotoStore {
  private readonly clients = inject(ClientsStore);
  private readonly preparePhoto = inject(PROFILE_PHOTO_PREPARER);

  private readonly _status = signal<PhotoStatus>('idle');
  private readonly _error = signal<string | null>(null);
  /** Corta el sondeo anterior al subir otra foto, quitarla, cambiar de cliente o destruir la cabecera. */
  private readonly cancel$ = new Subject<void>();

  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();
  readonly busy = computed(() => this._status() !== 'idle');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel$.next());
  }

  /** Cambio de cliente en la misma cabecera: se olvida el estado del anterior. */
  reset(): void {
    this.cancel$.next();
    this._error.set(null);
    this._status.set('idle');
  }

  /**
   * Prepara, sube y espera el veredicto. Emite una vez el desenlace; los errores de preparación y los
   * 400/404/413 del backend quedan en `error` (y se re-lanzan para que la vista devuelva el foco).
   */
  upload(customerId: string, file: File): Observable<PhotoUploadOutcome> {
    return defer(() => {
      this.cancel$.next();
      this._error.set(null);
      this._status.set('preparing');
      return from(this.preparePhoto(file)).pipe(
        tap(() => this._status.set('uploading')),
        switchMap(prepared => this.clients.uploadAvatar(customerId, prepared)),
        tap(() => this._status.set('processing')),
        switchMap(response => this.poll(customerId, response.fileId)),
        tap(outcome => this.settle(customerId, outcome)),
        catchError(err => {
          this._error.set(clientPhotoErrorMessage(err));
          return throwError(() => err);
        }),
        takeUntil(this.cancel$),
        finalize(() => this._status.set('idle')),
      );
    });
  }

  /** DELETE /customers/{id}/avatar; el cliente vuelve a las iniciales. */
  remove(customerId: string): Observable<void> {
    return defer(() => {
      this.cancel$.next();
      this._error.set(null);
      this._status.set('removing');
      return this.clients.deleteAvatar(customerId).pipe(
        catchError(err => {
          this._error.set(clientPhotoErrorMessage(err));
          return throwError(() => err);
        }),
        finalize(() => this._status.set('idle')),
      );
    });
  }

  /**
   * Se abrió la ficha con una foto aún en revisión (otra pestaña, recarga): sondea hasta el veredicto,
   * sin toast (no sabemos quién la subió). Emite el desenlace para que la vista recargue el detalle.
   */
  resume(customerId: string, pendingFileId: string): Observable<PhotoUploadOutcome> {
    return defer(() => {
      this.cancel$.next();
      this._error.set(null);
      this._status.set('processing');
      return this.poll(customerId, pendingFileId).pipe(
        tap(outcome => this.settle(customerId, outcome)),
        takeUntil(this.cancel$),
        finalize(() => this._status.set('idle')),
      );
    });
  }

  private poll(customerId: string, fileId: string): Observable<PhotoUploadOutcome> {
    return pollPhotoOutcome(
      () => this.clients.getById(customerId),
      detail => classifyCustomerAvatarPoll(detail, fileId),
    );
  }

  private settle(customerId: string, outcome: PhotoUploadOutcome): void {
    if (outcome === 'updated') {
      this.clients.afterPhotoChange(customerId);
    } else if (outcome === 'failed') {
      this._error.set(CLIENT_PHOTO_FAILED_MESSAGE);
    }
  }
}

/**
 * Texto para el usuario: el de la preparación local, el del backend en los 400 (`Avatar.*`,
 * `Customer.Archived`), uno propio para el 413 (el proxy puede responderlo sin JSON) y para el 404/403.
 */
export function clientPhotoErrorMessage(err: unknown): string {
  if (err instanceof ProfilePhotoError) {
    return err.message;
  }
  if (err instanceof HttpErrorResponse) {
    if (err.status === 413) {
      return PROFILE_PHOTO_MESSAGES.tooLarge;
    }
    if (err.status === 404 || err.status === 403) {
      return "You can't change this client's photo.";
    }
    if (err.status === 400) {
      const body = err.error as { code?: string; message?: string } | null;
      if (body?.code === 'Customer.Archived') {
        return "Archived clients can't have a photo.";
      }
      return body?.message || CLIENT_PHOTO_FAILED_MESSAGE;
    }
  }
  return toApiError(err).message;
}
