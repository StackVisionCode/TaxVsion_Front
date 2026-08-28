import { Injectable, OnDestroy, inject } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { TokenService } from '../auth/token.service';

export interface SessionExpiryState {
  show: boolean;
  remainingSeconds: number;
}

/**
 * Avisa al usuario ANTES de que expire el access token (15 min) con un modal para mantener o cerrar la
 * sesión, en vez de sacarlo en seco. Monitorea el `TokenService` (el mismo que puebla el login y lee el
 * guard). Robustez: además del intervalo, re-chequea al volver la pestaña al foco — en segundo plano el
 * navegador estrangula `setInterval` y la ventana de aviso (60s) se puede perder. Espejo del portal.
 */
@Injectable({ providedIn: 'root' })
export class SessionExpiryService implements OnDestroy {
  private readonly tokenService = inject(TokenService);

  private readonly WARNING_THRESHOLD_SECONDS = 60; // Aviso a 1 min de expirar (la barra del modal asume 60s)
  private readonly CHECK_INTERVAL_MS = 10000; // Chequear cada 10s

  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  private readonly expiryState = new BehaviorSubject<SessionExpiryState>({ show: false, remainingSeconds: 0 });
  readonly expiryState$ = this.expiryState.asObservable();

  /** El usuario eligió mantener la sesión → el root dispara el refresh. */
  private readonly sessionExtended = new Subject<void>();
  readonly sessionExtended$ = this.sessionExtended.asObservable();

  /** Se acabó el tiempo sin respuesta, o el usuario eligió cerrar → el root hace logout. */
  private readonly sessionExpired = new Subject<void>();
  readonly sessionExpired$ = this.sessionExpired.asObservable();

  private isWarningActive = false;

  private readonly onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.checkTokenExpiry();
    }
  };

  constructor() {
    this.startMonitoring();
  }

  ngOnDestroy(): void {
    this.stopMonitoring();
  }

  startMonitoring(): void {
    this.stopMonitoring();
    this.checkInterval = setInterval(() => this.checkTokenExpiry(), this.CHECK_INTERVAL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.stopCountdown();
  }

  private checkTokenExpiry(): void {
    const token = this.tokenService.getAccessToken();
    if (!token) {
      // Sin token (logout / sesión revocada): cerrar el aviso si estaba abierto, no debe quedar pegado.
      if (this.isWarningActive) {
        this.resetWarning();
      }
      return;
    }
    if (this.isWarningActive) {
      return;
    }

    const remainingSeconds = this.tokenService.getAccessTokenRemainingSeconds();
    if (remainingSeconds <= 0) {
      this.sessionExpired.next();
      return;
    }
    if (remainingSeconds <= this.WARNING_THRESHOLD_SECONDS) {
      this.showWarning(Math.floor(remainingSeconds));
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

  /** El usuario tocó "Keep session". */
  extendSession(): void {
    this.stopCountdown();
    this.expiryState.next({ show: false, remainingSeconds: 0 });
    this.isWarningActive = false;
    this.sessionExtended.next();
  }

  /** El usuario tocó "Logout" o se acabó el tiempo. */
  endSession(): void {
    this.stopCountdown();
    this.expiryState.next({ show: false, remainingSeconds: 0 });
    this.isWarningActive = false;
    this.sessionExpired.next();
  }

  /** Resetea el aviso (p. ej. tras un refresh exitoso). */
  resetWarning(): void {
    this.stopCountdown();
    this.expiryState.next({ show: false, remainingSeconds: 0 });
    this.isWarningActive = false;
  }

  private stopCountdown(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }
}
