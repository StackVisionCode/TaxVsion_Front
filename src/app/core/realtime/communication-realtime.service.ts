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
    //
    // `active` es la excepción: un socket que ya NO va a reintentar (el server cortó, o
    // el handshake se rechazó) sigue existiendo, y sin esta comprobación connect() se
    // volvía un no-op silencioso para siempre — la app se quedaba sin tiempo real hasta
    // recargar. Un socket muerto se tira y se rehace.
    if (this.socket) {
      if (this.socket.connected || this.socket.active) {
        return;
      }
      this.dispose();
    }
    if (!this.tokenService.getAccessToken()) {
      return;
    }
    this.socket = io(this.api.tenantBase(), {
      path: '/communication/socket.io',
      // WebSocket primero; polling solo de fallback. El gateway ya proxya el
      // upgrade WS (UseWebSockets en YARP), así que el WS —conexión persistente—
      // es el transporte estable: no sufre el buffering del long-poll que rompía
      // el ciclo ping/pong detrás de Cloudflare (ping timeout en bucle).
      transports: ['websocket', 'polling'],
      // Callback, NO objeto fijo: socket.io lo invoca en CADA intento de conexión, así
      // que las reconexiones mandan el token vigente. Con `auth: { token }` el token
      // quedaba congelado en el del primer connect y, tras un refresh (o al volver de una
      // pestaña en segundo plano con el token ya vencido), cada reintento reenviaba el
      // viejo: bucle de reconexión rechazada del que no se salía.
      auth: cb => cb({ token: this.tokenService.getAccessToken() ?? '' }),
      withCredentials: true,
    });
    this.bind(this.socket);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.dispose();
  }

  /**
   * Suelta un socket muerto DESDE SUS PROPIOS handlers. La comprobación de identidad
   * importa: si mientras tanto ya se construyó uno nuevo, el evento tardío del viejo no
   * debe tirar al que está vivo.
   */
  private discard(socket: Socket): void {
    if (this.socket !== socket) {
      socket.removeAllListeners();
      return;
    }
    socket.disconnect();
    this.dispose();
  }

  /** Suelta el socket y su estado derivado. No lo desconecta: eso lo decide quien llama. */
  private dispose(): void {
    // removeAllListeners antes de soltar la referencia: el onAny/`connect` de un socket
    // huérfano seguiría empujando eventos al Subject compartido (y marcando `connected`)
    // si el transporte tardaba en morir, mezclándose con los del socket nuevo.
    this.socket?.removeAllListeners();
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
    socket.on('disconnect', reason => {
      this.connected.set(false);
      // 'io server disconnect' = nos echó el server (típicamente el token venció mientras
      // la pestaña estaba en segundo plano). socket.io NO reintenta solo en ese caso, así
      // que se suelta el socket: sin esto quedaba un cadáver que hacía de connect() un
      // no-op para siempre. Rehacerlo es responsabilidad de quien posee el ciclo de vida
      // (el shell lo reintenta al volver el foco).
      if (reason === 'io server disconnect') {
        this.discard(socket);
      }
    });

    // Idem para un handshake rechazado que ya no va a reintentarse: se suelta para que el
    // próximo connect() pueda construir uno nuevo con el token vigente.
    socket.on('connect_error', () => {
      if (!socket.active) {
        this.discard(socket);
      }
    });

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
