import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '@core/auth/auth.service';
import { CommunicationRealtimeService } from './communication-realtime.service';
import { SESSION_EXPIRING_EVENT, SessionExpiringEvent } from './realtime.model';

/**
 * F3 — mantiene vivo el socket al vencer el JWT: `session.expiring` llega ~60 s antes de que el
 * servidor cierre el socket por `exp`; se renueva el access token con el refresh normal y se manda
 * `auth.refresh` con el token nuevo (sin reconectar, así una reunión mesh larga no pierde la
 * señalización). Si el refresh falla, se acepta la desconexión: el socket reconectará con el token
 * que tenga. Lo arranca el shell autenticado, que posee el ciclo de vida del socket.
 */
@Injectable({ providedIn: 'root' })
export class SocketSessionRefreshService {
  private readonly realtime = inject(CommunicationRealtimeService);
  private readonly auth = inject(AuthService);
  private started = false;

  start(destroyRef: DestroyRef): void {
    if (this.started) {
      return;
    }
    this.started = true;
    destroyRef.onDestroy(() => (this.started = false));
    this.realtime
      .on<SessionExpiringEvent>(SESSION_EXPIRING_EVENT)
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => this.renew());
  }

  private renew(): void {
    this.auth.refresh().subscribe({
      next: tokens => void this.realtime.refreshAuth(tokens.accessToken),
      error: () => undefined, // sin refresh posible: el servidor cerrará el socket y se reconectará luego
    });
  }
}
