import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { toApiError } from '@core/models/api-error.model';
import { ClientSmsService } from './client-sms.service';
import { CLIENT_SMS_SOURCE_CONTEXT, ClientSmsOutcome, smsErrorMessage, smsOutcome } from './client-sms.model';

/**
 * Estado del "Send SMS" del perfil de cliente. Un envío = un mensaje a un número del cliente.
 * Devuelve siempre un `ClientSmsOutcome` en lenguaje simple (nunca lanza): el modal decide si
 * cerrar (ok) o mostrar el error y dejar reintentar.
 */
@Injectable({ providedIn: 'root' })
export class ClientSmsStore {
  private readonly service = inject(ClientSmsService);

  private readonly _sending = signal(false);
  readonly sending = this._sending.asReadonly();

  send(customerId: string, to: string, recipientName: string, body: string): Observable<ClientSmsOutcome> {
    this._sending.set(true);
    return this.service
      .send({
        messages: [
          {
            customerId,
            to,
            message: body.trim(),
            recipientName: recipientName || null,
            media: null,
            idempotencyKey: crypto.randomUUID(),
            sourceContext: CLIENT_SMS_SOURCE_CONTEXT,
          },
        ],
      })
      .pipe(
        map(smsOutcome),
        catchError(err => {
          const apiError = toApiError(err);
          const status = err instanceof HttpErrorResponse ? err.status : -1;
          const message =
            status === 403
              ? "You don't have permission to send text messages."
              : status === 429
                ? 'Too many messages in a short time. Wait a moment and try again.'
                : apiError.code.startsWith('sms.')
                  ? smsErrorMessage(apiError.code)
                  : apiError.message;
          return of({ ok: false, message });
        }),
        finalize(() => this._sending.set(false)),
      );
  }
}
