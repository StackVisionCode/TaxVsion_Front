import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { SubscriptionStatusStore } from '@core/billing/subscription-status.store';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { AccessStore } from './access.store';
import { featureForUrl } from './features';

/**
 * Ventana mínima entre dos comprobaciones rutinarias. No aplica a `access.changed`: ese evento dice
 * que algo cambió AHORA y merece la petición aunque acabe de haber una.
 */
const MIN_GAP_MS = 5_000;

/** Payload de `access.changed`. No trae datos: solo dice "volvé a pedir el bootstrap". */
interface AccessChangedEvent {
  scope: 'user' | 'tenant';
  /** El `perm_v` nuevo cuando el cambio es del usuario; null cuando es del tenant. */
  permissionsVersion: number | null;
}

/**
 * B8 — que la UI converja sola cuando cambian los permisos, los roles o el plan.
 *
 * Hasta acá el bootstrap se pedía una sola vez, al arrancar. Un administrador que le quitaba un
 * permiso a alguien tenía que pedirle que recargara: hasta entonces la UI le seguía ofreciendo
 * botones que el backend ya rechazaba. Es el caso 1 del Anexo C.
 *
 * Cuatro disparadores, a propósito redundantes — el evento en vivo es el bueno, los otros tres son
 * la red que lo sostiene si el socket se cayó, la pestaña estuvo dormida o el token se renovó:
 *
 * 1. `access.changed` por el socket — inmediato.
 * 2. Volver el foco a la pestaña — cubre el rato en que estuvo en segundo plano.
 * 3. Reconexión del socket — cubre el corte durante el cual no llegó ningún evento.
 * 4. Renovación del token — un 401 `Auth.TokenStale` significa que los permisos del token quedaron
 *    viejos; los de la UI también.
 *
 * Y, después de cada refresco, se vuelve a evaluar la ruta actual: si el usuario perdió el acceso a
 * la pantalla en la que está, no alcanza con esconderle los botones.
 */
@Injectable({ providedIn: 'root' })
export class AccessSyncService {
  private readonly access = inject(AccessStore);
  private readonly auth = inject(AuthService);
  private readonly socket = inject(CommunicationRealtimeService);
  private readonly subscription = inject(SubscriptionStatusStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  private started = false;
  private lastRefreshAt = 0;

  /** Lo llama el shell autenticado. Idempotente: entrar dos veces no duplica los listeners. */
  start(destroyRef: DestroyRef): void {
    if (this.started) {
      return;
    }
    this.started = true;

    this.socket
      .on<AccessChangedEvent>('access.changed')
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(event => this.onAccessChanged(event));

    this.socket.reconnected$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => this.refresh({ force: false }));

    this.auth.refreshed$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => this.refresh({ force: false }));

    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('focus', this.onFocus);
    destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', this.onVisible);
      window.removeEventListener('focus', this.onFocus);
      this.started = false;
    });
  }

  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible') {
      this.refresh({ force: false });
    }
  };

  private readonly onFocus = (): void => this.refresh({ force: false });

  /**
   * Un evento del propio usuario trae el `perm_v` nuevo. Si no es mayor que el que ya tenemos, el
   * evento llegó tarde o duplicado y no hay nada que pedir — el socket no garantiza el orden.
   */
  private onAccessChanged(event: AccessChangedEvent): void {
    if (event.scope === 'user' && event.permissionsVersion !== null) {
      const current = this.access.permissionsVersion();
      if (current !== null && event.permissionsVersion <= current) {
        return;
      }
    }
    this.refresh({ force: true });
  }

  /**
   * Vuelve a pedir el bootstrap ignorando el ETag y, cuando llega, revisa si el usuario todavía
   * puede estar donde está.
   *
   * El banner de suscripción se recarga junto con esto en vez de leerse del bootstrap: el bootstrap
   * solo dice `active | billing_blocked | suspended`, y el banner distingue PastDue de GracePeriod y
   * muestra la fecha de corte. Pisar el dato rico con el pobre sería una regresión; lo que hacía
   * falta era que se enterara, no que cambiara de fuente.
   */
  private refresh(options: { force: boolean }): void {
    // Volver a la pestaña dispara `focus` Y `visibilitychange` en el mismo gesto, y moverse por la
    // aplicación dispara `focus` seguido. Sin esta ventana, un solo clic costaba varias peticiones.
    const now = Date.now();
    if (!options.force && now - this.lastRefreshAt < MIN_GAP_MS) {
      return;
    }
    this.lastRefreshAt = now;

    // Rutinario = condicional (`If-None-Match` → 304 sin cuerpo). Solo `access.changed` fuerza la
    // respuesta entera: ahí SABEMOS que cambió y el ETag viejo ya no sirve de nada.
    const arrived = options.force ? this.access.reload() : this.access.load();

    void arrived.then(() => {
      this.subscription.load();
      this.enforceCurrentRoute();
    });
  }

  private enforceCurrentRoute(): void {
    const feature = featureForUrl(this.router.url);
    if (!feature) {
      return;
    }
    const state = this.access.stateOf(feature);
    if (state.available) {
      return;
    }

    // Esconder los botones no alcanza: el usuario está MIRANDO una pantalla que ya no le toca.
    this.toast.info(
      state.reason === 'plan'
        ? `${feature.label} is no longer part of your plan.`
        : `Your access to ${feature.label} was changed.`,
    );
    void this.router.navigate([state.reason === 'plan' ? '/not-available' : '/forbidden'], {
      queryParams: { feature: feature.id, from: this.router.url },
    });
  }
}
