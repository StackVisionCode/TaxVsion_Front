import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';

/** Payload de `mail.incoming` (Communication) — solo ids, sin asunto ni cuerpo. */
export interface MailIncomingEmailPayload {
  customerId: string;
  emailThreadId: string;
  incomingEmailId: string;
}

/** Payload de `mail.thread_state`: estado visible de un hilo tras leerlo, archivarlo o mover un mensaje. */
export interface MailThreadStatePayload {
  customerId: string;
  emailThreadId: string;
  status: string;
  unreadCount: number;
  messageCount: number;
  actorUserId: string | null;
}

/**
 * Fachada de realtime del módulo Mail sobre {@link CommunicationRealtimeService}. Solo
 * escucha `mail.incoming`: cuando llega un correo entrante de un cliente, Communication lo
 * emite a la sala del tenant y el store decide si recarga los hilos. No envía nada.
 *
 * Comparte el ÚNICO socket de Communication (antes abría uno propio): el ciclo de vida lo
 * posee el shell autenticado.
 */
@Injectable({ providedIn: 'root' })
export class MailSocketService {
  private readonly realtime = inject(CommunicationRealtimeService);

  readonly connected = this.realtime.connected;
  readonly incomingEmail$: Observable<MailIncomingEmailPayload> =
    this.realtime.on<MailIncomingEmailPayload>('mail.incoming');
  /** Otro empleado (u otra pestaña) leyó, archivó o movió a la papelera algo de un hilo. */
  readonly threadState$: Observable<MailThreadStatePayload> =
    this.realtime.on<MailThreadStatePayload>('mail.thread_state');

  /** Asegura que el socket compartido esté arriba. Idempotente; normalmente el shell ya lo conectó. */
  connect(): void {
    this.realtime.connect();
  }

  /**
   * No-op deliberado. El socket de Communication es COMPARTIDO (chat, presencia y
   * session.revoked viajan por él) y su ciclo de vida lo posee el shell. Salir del módulo
   * Mail no debe cerrarlo. Se conserva el método para no cambiar el call site de mail.store.
   */
  disconnect(): void {
    /* intencionalmente no cierra el socket compartido */
  }
}
