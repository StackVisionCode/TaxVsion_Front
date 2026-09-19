import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';

/** Payload de `signature.request.changed` (Communication): solo el id — el front recarga la lista por HTTP. */
export interface SignatureRequestChangedPayload {
  signatureRequestId: string;
}

/**
 * Fachada de realtime del módulo Signature sobre {@link CommunicationRealtimeService}. Escucha
 * `signature.request.changed`: cuando un firmante firma/rechaza o la solicitud cambia de estado,
 * Communication lo emite por-tenant y aquí lo republicamos para que el store refresque la lista sin
 * recargar la página. Mismo patrón que MailSocketService. El ciclo de vida del socket lo posee el
 * shell autenticado — esta fachada nunca lo cierra.
 */
@Injectable({ providedIn: 'root' })
export class SignatureRealtimeService {
  private readonly realtime = inject(CommunicationRealtimeService);

  readonly connected = this.realtime.connected;
  readonly requestChanged$: Observable<SignatureRequestChangedPayload> =
    this.realtime.on<SignatureRequestChangedPayload>('signature.request.changed');

  /** Idempotente: asegura el socket compartido abierto. El shell ya lo abre; esto es defensivo. */
  connect(): void {
    this.realtime.connect();
  }
}
