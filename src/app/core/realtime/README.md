# core/realtime/

Infraestructura de sockets transversal del CRM.

- **`communication-realtime.service.ts`** — conexión Socket.IO ÚNICA a Communication
  (`/communication/socket.io`, token en `handshake.auth.token`, `withCredentials`).
  Desenvuelve el `SocketEnvelope`, deduplica por `eventId`, expone `on<T>(event)` /
  `emitAck` / `emitNoAck` / `newClientKey`, y `reconnected$` para que cada feature
  re-sincronice tras un corte. El ciclo de vida (connect/disconnect) lo posee el shell
  autenticado (`app-shell.component.ts`); ninguna feature cierra el socket al desmontarse.
- **`realtime.model.ts`** — `SocketEnvelope<T>` y `SocketAck<T>` canónicos.

Las features NO abren su propio socket: `ChatSocketService` y `MailSocketService` son
fachadas tipadas sobre este servicio. Calls/meetings/notifications se montarán igual.
