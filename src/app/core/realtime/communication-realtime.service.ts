import { Injectable, inject, signal } from '@angular/core';
import { Socket, io } from 'socket.io-client';
import { Observable, Subject, filter, map } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { TokenService } from '@core/auth/token.service';
import { SocketAck, SocketEnvelope } from './realtime.model';

const ACK_TIMEOUT_MS = 10_000;
/** Tope del anillo de eventId vistos — cubre ráfagas de re-entrega sin crecer sin límite. */
const DEDUPE_CAPACITY = 500;

/**
 * Conexión Socket.IO ÚNICA a Communication (Node/Fastify vía Gateway). Todas las
 * features de tiempo real (chat, mail, presencia, session.revoked y, más adelante,
 * calls/meetings/notifications) comparten este socket en vez de abrir uno cada una.
 *
 * Path fijo `/communication/socket.io`, token en `handshake.auth.token` (nunca en la
 * query string). Desenvuelve el `SocketEnvelope` de cada evento server->cliente,
 * deduplica por `eventId` y republica `{ event, payload }` por un Subject genérico que
 * cada feature filtra con {@link on}. El ciclo de vida (connect/disconnect) lo posee el
 * shell autenticado: ninguna feature debe cerrar el socket al desmontarse.
 */
@Injectable({ providedIn: 'root' })
export class CommunicationRealtimeService {
  private readonly api = inject(ApiConfigService);
  private readonly tokenService = inject(TokenService);

  private socket: Socket | null = null;

  /** true mientras el transporte Socket.IO está conectado. */
  readonly connected = signal(false);

  private readonly events$ = new Subject<{ event: string; payload: unknown }>();

  /**
   * Emite cuando el socket se RE-establece tras una caída (no en el primer connect).
   * Es la señal para que cada feature re-sincronice lo que pudo perderse durante el
   * corte (re-fetch de listas, backfill con `?since=`, refresco de no-leídos).
   */
  private readonly _reconnected$ = new Subject<void>();
  readonly reconnected$ = this._reconnected$.asObservable();

  /** eventId ya surtidos, en orden de llegada — para descartar re-entregas del server. */
  private readonly seenEventIds = new Set<string>();
  private hasConnectedOnce = false;

  connect(): void {
    // Guard por EXISTENCIA, no por `connected`: el shell y el chat store llaman a
    // connect() a veces en el mismo tick, y durante la ventana previa a conectar el
    // socket existe pero `connected` es false — guardar por `connected` abriría un
    // segundo socket.
    if (this.socket) {
      return;
    }
    const token = this.tokenService.getAccessToken();
    if (!token) {
      return;
    }
    this.socket = io(this.api.tenantBase(), {
      path: '/communication/socket.io',
      // WebSocket primero; polling solo de fallback. El gateway ya proxya el
      // upgrade WS (UseWebSockets en YARP), así que el WS —conexión persistente—
      // es el transporte estable: no sufre el buffering del long-poll que rompía
      // el ciclo ping/pong detrás de Cloudflare (ping timeout en bucle).
      transports: ['websocket', 'polling'],
      auth: { token },
      withCredentials: true,
    });
    this.bind(this.socket);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connected.set(false);
    this.seenEventIds.clear();
    this.hasConnectedOnce = false;
  }

  /** Observable filtrado por nombre de evento, ya con el payload desenvuelto. */
  on<T>(event: string): Observable<T> {
    return this.events$.pipe(
      filter(e => e.event === event),
      map(e => e.payload as T),
    );
  }

  /**
   * Comando cliente->server con ack. Devuelve el `SocketAck` (nunca lanza): mapea la
   * falta de conexión y el timeout a códigos propios para que la UI los traduzca. El
   * `clientKey` de idempotencia lo pone cada llamante con {@link newClientKey}.
   */
  async emitAck<T>(event: string, payload: object): Promise<SocketAck<T>> {
    if (!this.socket?.connected) {
      return { ok: false, code: 'Socket.NotConnected', message: 'Not connected to the communication server.' };
    }
    try {
      return (await this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, payload)) as SocketAck<T>;
    } catch {
      return { ok: false, code: 'Socket.Timeout', message: 'The communication server did not respond in time.' };
    }
  }

  /** Comando sin ack (fire-and-forget), p. ej. `chat.typing.start`, `call.media_status`. */
  emitNoAck(event: string, payload: object): void {
    this.socket?.emit(event, payload);
  }

  newClientKey(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private bind(socket: Socket): void {
    socket.on('connect', () => {
      this.connected.set(true);
      // El primer 'connect' es el arranque normal; los siguientes son reconexiones.
      if (this.hasConnectedOnce) {
        this._reconnected$.next();
      }
      this.hasConnectedOnce = true;
    });
    socket.on('disconnect', () => this.connected.set(false));

    // onAny capta cualquier nombre de evento sin registrar uno por uno.
    socket.onAny((event: string, envelope: SocketEnvelope<unknown>) => {
      if (this.isDuplicate(envelope)) {
        return;
      }
      this.events$.next({ event, payload: envelope?.payload ?? envelope });
    });
  }

  /** Descarta una re-entrega de un evento ya surtido (dedupe por eventId). */
  private isDuplicate(envelope: SocketEnvelope<unknown> | undefined): boolean {
    const id = envelope?.eventId;
    if (!id) {
      // Sin eventId no se puede deduplicar (p. ej. eventos crudos sin sobre): pasa.
      return false;
    }
    if (this.seenEventIds.has(id)) {
      return true;
    }
    this.seenEventIds.add(id);
    if (this.seenEventIds.size > DEDUPE_CAPACITY) {
      // El Set conserva orden de inserción: el primero es el más viejo.
      const oldest = this.seenEventIds.values().next().value;
      if (oldest !== undefined) {
        this.seenEventIds.delete(oldest);
      }
    }
    return false;
  }
}
