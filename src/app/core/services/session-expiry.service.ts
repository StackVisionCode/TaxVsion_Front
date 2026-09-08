import { Injectable, OnDestroy, inject } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { TokenService } from '../auth/token.service';

export interface SessionExpiryState {
  show: boolean;
  remainingSeconds: number;
}

/** Sin DOM (tests) se asume visible: el comportamiento por defecto no debe depender del entorno. */
function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Aviso de sesión por INACTIVIDAD (no por un timer fijo desde el login). El modal aparece cuando el
 * usuario lleva `IDLE_WARNING` sin interactuar; mientras SÍ usa la app, el access token se refresca en
 * silencio para que no muera a mitad de uso y el modal nunca lo interrumpa. Cualquier interacción real
 * (mouse, teclado, scroll, touch) reinicia el reloj de inactividad.
 *
 * Pestaña en segundo plano: el navegador estrangula `setInterval`, así que el reloj no es fiable
 * ahí. Se maneja con dos reglas, no con una: (a) el aviso NO se abre mientras la pestaña está
 * oculta —se abre al volver el foco, para que sus 60s se vean enteros— y (b) un access token
 * vencido no cierra sesión por sí solo: se intenta el refresh y solo si ESE falla se hace logout.
 * Sin la segunda, volver de otra pestaña tras un rato caía directo en el login sin aviso.
 */
@Injectable({ providedIn: 'root' })
export class SessionExpiryService implements OnDestroy {
  private readonly tokenService = inject(TokenService);

  /** Inactividad tras la que se muestra el aviso (el compañero pidió 14 min). */
  private readonly IDLE_WARNING_MS = 14 * 60 * 1000;
  /** Segundos del countdown del modal antes del logout (la barra del modal asume 60s). */
  private readonly WARNING_COUNTDOWN_SECONDS = 60;
  /** Refresca el token en silencio cuando le quedan <= esto Y el usuario NO está inactivo. */
  private readonly REFRESH_MARGIN_SECONDS = 120;
  private readonly CHECK_INTERVAL_MS = 10000; // Chequear cada 10s

  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  private readonly expiryState = new BehaviorSubject<SessionExpiryState>({ show: false, remainingSeconds: 0 });
  readonly expiryState$ = this.expiryState.asObservable();

  /** El usuario eligió mantener la sesión, o hubo actividad con el token por vencer → el root refresca. */
  private readonly sessionExtended = new Subject<void>();
  readonly sessionExtended$ = this.sessionExtended.asObservable();

  /** Se acabó el tiempo sin respuesta, o el usuario eligió cerrar → el root hace logout. */
  private readonly sessionExpired = new Subject<void>();
  readonly sessionExpired$ = this.sessionExpired.asObservable();

  private isWarningActive = false;
  /** Evita disparar varios refresh mientras uno está en vuelo (se limpia en resetWarning). */
  private refreshInFlight = false;
  /** Último instante con interacción real del usuario — el reloj de inactividad se mide contra esto. */
  private lastActivityAt = Date.now();

  private readonly onVisibilityChange = () => {
    if (!isDocumentHidden()) {
      this.checkTokenExpiry();
    }
  };

  /** Interacción real: reinicia el reloj de inactividad. NO se cuenta mientras el modal está abierto (decisión explícita). */
  private readonly onActivity = () => {
    if (!this.isWarningActive) {
      this.lastActivityAt = Date.now();
    }
  };

  private static readonly ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'];

  constructor() {
    this.startMonitoring();
  }

  ngOnDestroy(): void {
    this.stopMonitoring();
  }

  startMonitoring(): void {
    this.stopMonitoring();
    // El reloj de inactividad arranca ahora (login / arranque de la app autenticada).
    this.lastActivityAt = Date.now();
    this.checkInterval = setInterval(() => this.checkTokenExpiry(), this.CHECK_INTERVAL_MS);
    if (typeof window !== 'undefined') {
      for (const evt of SessionExpiryService.ACTIVITY_EVENTS) {
        window.addEventListener(evt, this.onActivity, { passive: true });
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (typeof window !== 'undefined') {
      for (const evt of SessionExpiryService.ACTIVITY_EVENTS) {
        window.removeEventListener(evt, this.onActivity);
      }
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.stopCountdown();
  }

  private checkTokenExpiry(): void {
    const token = this.tokenService.getAccessToken();
    if (!token) {
      // Sin token (logout / sesión revocada): limpiar el aviso y cualquier refresh en vuelo.
      this.refreshInFlight = false;
      if (this.isWarningActive) {
        this.resetWarning();
      }
      return;
    }
    if (this.isWarningActive) {
      return;
    }

    const remainingSeconds = this.tokenService.getAccessTokenRemainingSeconds();
    const idleMs = Date.now() - this.lastActivityAt;

    // 1) Demasiado tiempo sin interacción → mostrar el aviso (countdown → logout).
    if (idleMs >= this.IDLE_WARNING_MS) {
      // Con la pestaña oculta el aviso NO se abre: su countdown de 60s correría
      // estrangulado por el navegador y el usuario se encontraría el modal ya vencido (o la
      // sesión cerrada) al volver, sin haber tenido ocasión de responder. Se abre al
      // recuperar el foco — `onVisibilityChange` vuelve a entrar acá — para que la ventana
      // de aviso se vea entera. Mientras tanto no se refresca nada, así que la sesión
      // muere sola igual: no se está alargando la vida de una pestaña abandonada.
      if (isDocumentHidden()) {
        return;
      }
      this.showWarning(this.WARNING_COUNTDOWN_SECONDS);
      return;
    }

    // 2) El usuario sigue dentro de la ventana de actividad. Que el ACCESS token esté
    //    vencido no es motivo de logout — para eso está el refresh token: se extiende en
    //    silencio y solo si ESE refresh falla se cierra la sesión (lo hace `App`).
    //
    //    Antes había aquí un `remainingSeconds <= 0 → sessionExpired` que cortaba por lo
    //    sano, y era justo el camino que se tomaba al volver de una pestaña en segundo
    //    plano: con los timers estrangulados el refresh silencioso no llegaba a correr, el
    //    token vencía, y el usuario aterrizaba en el login sin aviso ninguno.
    //
    //    El reloj de inactividad NO se toca (solo lo reinicia la interacción real), así que
    //    el aviso igual saldrá a los 14 min de que deje de usar la app.
    if (!this.refreshInFlight && remainingSeconds <= this.REFRESH_MARGIN_SECONDS) {
      this.refreshInFlight = true;
      this.sessionExtended.next();
    }
  }

  private showWarning(remainingSeconds: number): void {
    this.isWarningActive = true;
    this.expiryState.next({ show: true, remainingSeconds });

    this.countdownInterval = setInterval(() => {
      const current = this.expiryState.value.remainingSeconds;
      if (current <= 1) {
        this.stopCountdown();
        this.expiryState.next({ show: false, remainingSeconds: 0 });
        this.isWarningActive = false;
        this.sessionExpired.next();
        return;
      }
      this.expiryState.next({ show: true, remainingSeconds: current - 1 });
    }, 1000);
  }

  /** El usuario tocó "Keep session": reinicia el reloj de inactividad y dispara el refresh. */
  extendSession(): void {
    this.stopCountdown();
    this.expiryState.next({ show: false, remainingSeconds: 0 });
    this.isWarningActive = false;
    this.lastActivityAt = Date.now();
    this.refreshInFlight = true;
    this.sessionExtended.next();
  }

  /** El usuario tocó "Logout" o se acabó el tiempo. */
  endSession(): void {
    this.stopCountdown();
    this.expiryState.next({ show: false, remainingSeconds: 0 });
    this.isWarningActive = false;
    this.sessionExpired.next();
  }

  /** Resetea el aviso (p. ej. tras un refresh exitoso, silencioso o explícito). */
  resetWarning(): void {
    this.stopCountdown();
    this.expiryState.next({ show: false, remainingSeconds: 0 });
    this.isWarningActive = false;
    this.refreshInFlight = false;
  }

  private stopCountdown(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }
}
