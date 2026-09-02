import { Injectable, inject, signal } from '@angular/core';
import { Socket, io } from 'socket.io-client';
import { Subject } from 'rxjs';
import { TokenService } from '@core/auth/token.service';
import { ApiConfigService } from '@core/config/api-config.service';

/** Payload de `mail.incoming` (Communication) — solo ids, sin asunto ni cuerpo. */
export interface MailIncomingEmailPayload {
  customerId: string;
  emailThreadId: string;
  incomingEmailId: string;
}

interface SocketEnvelope<T> {
  payload: T;
}

/**
 * Socket realtime del módulo Mail. Se conecta al MISMO Socket.IO de Communication que el chat
 * (`/communication/socket.io` vía Gateway, token en `handshake.auth`), pero solo escucha
 * `mail.incoming`: cuando llega un correo entrante de un cliente, Communication lo emite a la room
 * del tenant (`t:{tenantId}`, a la que todo socket autenticado se une al conectar) y el store decide
 * si recarga los hilos. No envía nada al server — es solo escucha.
 *
 * TODO: cuando exista `core/realtime` (socket compartido), consolidar esta conexión con la del chat
 * para no abrir dos sockets por usuario.
 */
@Injectable({ providedIn: 'root' })
export class MailSocketService {
  private readonly tokenService = inject(TokenService);
  private readonly api = inject(ApiConfigService);
  private socket: Socket | null = null;

  readonly connected = signal(false);
  readonly incomingEmail$ = new Subject<MailIncomingEmailPayload>();

  connect(): void {
    if (this.socket) {
      return;
    }
    const token = this.tokenService.getAccessToken();
    if (!token) {
      return;
    }
    this.socket = io(this.api.tenantBase(), {
      path: '/communication/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    this.socket.on('connect', () => this.connected.set(true));
    this.socket.on('disconnect', () => this.connected.set(false));
    this.socket.on('mail.incoming', (env: SocketEnvelope<MailIncomingEmailPayload>) =>
      this.incomingEmail$.next(env.payload),
    );
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connected.set(false);
  }
}
